/**
 * 백필 — 작업 DB(lc-scheduler-db:) row 의 org/팀/프로젝트 비정규화 scope 키와
 * 구성원(assignee)별 색인 테이블 엔트리를 보정한다.
 *
 * 배경:
 * - listDatabaseRows 의 scope/구성원 서버 필터링은 다음 두 가지에 의존한다.
 *   1) Pages 항목의 비정규화 키 dbScopeOrg/dbScopeTeam/dbScopeProject (sparse GSI 색인용)
 *      형식: `${databaseId}#${scopeId}`.
 *   2) 구성원 색인 테이블(quicknote-database-row-members): per-assignee 엔트리
 *      PK=`${databaseId}#${memberId}`, SK=pageId.
 * - 기능 도입 이전에 저장된 row 에는 위 데이터가 없으므로 1회 백필이 필요하다.
 *   (이후 upsertPage 가 자동으로 유지한다.)
 *
 * 처리(작업 DB row = databaseId startsWith "lc-scheduler-db:" 만 대상):
 * - dbCells 에서 scope 셀(lc-scheduler:organization/team/project)을 읽어
 *   값이 있으면 dbScope* 를 SET, 없으면 REMOVE (현재 값과 다를 때만 기록 → 멱등).
 * - dbCells.lc-scheduler:assignees 의 각 memberId 에 대해 색인 엔트리 Put.
 *   (삭제된 row 는 색인 대상에서 제외.)
 *
 * 안전장치:
 * - 기본 DRY-RUN(쓰기 없음). 실제 기록은 `--apply` 플래그가 있을 때만.
 * - 멱등: 재실행해도 동일 결과. Put 은 덮어쓰기라 안전.
 *
 * 실행:
 *   cd infra
 *   AWS_REGION=ap-northeast-2 npx ts-node scripts/backfill-database-row-scope.ts          # dry-run
 *   AWS_REGION=ap-northeast-2 npx ts-node scripts/backfill-database-row-scope.ts --apply  # 실제 기록
 *
 * 자격증명: 기본 AWS 자격증명 체인(env/SSO/프로파일).
 * 테이블명: 기본 "quicknote-page" / "quicknote-database-row-members",
 *           필요 시 PAGES_TABLE_NAME / DATABASE_ROW_MEMBERS_TABLE_NAME 으로 오버라이드.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const PAGES_TABLE = process.env.PAGES_TABLE_NAME ?? "quicknote-page";
const MEMBERS_INDEX_TABLE =
  process.env.DATABASE_ROW_MEMBERS_TABLE_NAME ?? "quicknote-database-row-members";
const APPLY = process.argv.includes("--apply");

const LC_TASK_DB_PREFIX = "lc-scheduler-db:";
const COL = {
  organization: "lc-scheduler:organization",
  team: "lc-scheduler:team",
  project: "lc-scheduler:project",
  assignees: "lc-scheduler:assignees",
} as const;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseCells(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return isPlainObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isPlainObject(raw) ? raw : null;
}

function readScope(cells: Record<string, unknown>, columnId: string): string | null {
  const raw = cells[columnId];
  if (raw == null) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return null;
}

function readAssignees(cells: Record<string, unknown>): string[] {
  const raw = cells[COL.assignees];
  const out: string[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string" && item.trim()) out.push(item.trim());
    }
  } else if (typeof raw === "string") {
    out.push(...raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean));
  }
  return Array.from(new Set(out));
}

async function flushMemberIndex(requests: Array<Record<string, unknown>>): Promise<void> {
  if (!APPLY || !requests.length) return;
  for (let i = 0; i < requests.length; i += 25) {
    const chunk = requests.slice(i, i + 25);
    await ddb.send(
      new BatchWriteCommand({ RequestItems: { [MEMBERS_INDEX_TABLE]: chunk } }),
    );
  }
}

async function main(): Promise<void> {
  console.log(
    `[backfill-database-row-scope] pages=${PAGES_TABLE} members=${MEMBERS_INDEX_TABLE} mode=${APPLY ? "APPLY" : "DRY-RUN"}`,
  );
  let scanned = 0;
  let taskRows = 0;
  let scopeUpdated = 0;
  let memberEntries = 0;
  let exclusiveStartKey: Record<string, unknown> | undefined;
  let pendingMemberRequests: Array<Record<string, unknown>> = [];

  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: PAGES_TABLE,
        ExclusiveStartKey: exclusiveStartKey,
        ProjectionExpression:
          "id, workspaceId, databaseId, dbCells, #order, updatedAt, deletedAt, dbScopeOrg, dbScopeTeam, dbScopeProject",
        ExpressionAttributeNames: { "#order": "order" },
      }),
    );
    const items = (res.Items ?? []) as Array<Record<string, unknown>>;
    scanned += items.length;

    for (const item of items) {
      const databaseId = item.databaseId;
      if (typeof databaseId !== "string" || !databaseId.startsWith(LC_TASK_DB_PREFIX)) continue;
      const id = item.id;
      if (typeof id !== "string") continue;
      taskRows += 1;

      const cells = parseCells(item.dbCells) ?? {};
      const org = readScope(cells, COL.organization);
      const team = readScope(cells, COL.team);
      const project = readScope(cells, COL.project);
      const desired = {
        dbScopeOrg: org != null ? `${databaseId}#${org}` : null,
        dbScopeTeam: team != null ? `${databaseId}#${team}` : null,
        dbScopeProject: project != null ? `${databaseId}#${project}` : null,
      };

      // 현재 값과 다른 항목만 갱신(멱등).
      const setExprs: string[] = [];
      const removeExprs: string[] = [];
      const values: Record<string, unknown> = {};
      const names: Record<string, string> = {};
      for (const [attr, want] of Object.entries(desired)) {
        const current = item[attr];
        if (want != null) {
          if (current !== want) {
            const nk = `#${attr}`;
            const vk = `:${attr}`;
            names[nk] = attr;
            values[vk] = want;
            setExprs.push(`${nk} = ${vk}`);
          }
        } else if (attr in item && current != null) {
          const nk = `#${attr}`;
          names[nk] = attr;
          removeExprs.push(nk);
        }
      }
      if (setExprs.length || removeExprs.length) {
        scopeUpdated += 1;
        const parts: string[] = [];
        if (setExprs.length) parts.push(`SET ${setExprs.join(", ")}`);
        if (removeExprs.length) parts.push(`REMOVE ${removeExprs.join(", ")}`);
        if (APPLY) {
          await ddb.send(
            new UpdateCommand({
              TableName: PAGES_TABLE,
              Key: { id },
              UpdateExpression: parts.join(" "),
              ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
              ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
            }),
          );
        }
      }

      // 구성원 색인 — 삭제되지 않은 row 만.
      const deletedAt = item.deletedAt;
      const isDeleted = typeof deletedAt === "string" && deletedAt !== "";
      if (!isDeleted) {
        const order = typeof item.order === "string" ? item.order : "0";
        const updatedAt =
          typeof item.updatedAt === "string" ? item.updatedAt : new Date(0).toISOString();
        for (const memberId of readAssignees(cells)) {
          memberEntries += 1;
          pendingMemberRequests.push({
            PutRequest: {
              Item: {
                id: `${id}::${memberId}`,
                pk: `${databaseId}#${memberId}`,
                pageId: id,
                databaseId,
                memberId,
                order,
                workspaceId: "lc-scheduler-global",
                updatedAt,
              },
            },
          });
          if (pendingMemberRequests.length >= 25) {
            await flushMemberIndex(pendingMemberRequests);
            pendingMemberRequests = [];
          }
        }
      }
    }

    exclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  await flushMemberIndex(pendingMemberRequests);

  console.log(
    `[backfill-database-row-scope] scanned=${scanned} taskRows=${taskRows} scopeUpdated=${scopeUpdated} memberEntries=${memberEntries} ${APPLY ? "(written)" : "(dry-run, no writes)"}`,
  );
}

main().catch((err) => {
  console.error("[backfill-database-row-scope] FAILED", err);
  process.exit(1);
});
