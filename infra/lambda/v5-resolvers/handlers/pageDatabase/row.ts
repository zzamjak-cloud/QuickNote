import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  badRequest,
  requireWorkspaceAccess,
  type Member,
} from "../_auth";
import type { Tables } from "../member";
import { type Connection, isPlainObject } from "./_shared";

/** dbCells(문자열/객체)에서 단일 scope 셀 값을 읽어 ${databaseId}#${id} 형식으로 비교 가능하게 한다. */
function pageScopeValue(
  page: Record<string, unknown>,
  columnId: string,
): string | null {
  let cells: Record<string, unknown> | null = null;
  const raw = page.dbCells;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      cells = isPlainObject(parsed) ? parsed : null;
    } catch {
      cells = null;
    }
  } else if (isPlainObject(raw)) {
    cells = raw;
  }
  if (!cells) return null;
  return readScopeCellValue(cells, columnId);
}

/**
 * assigneeId 지정 시: 작업 DB 구성원 색인(DatabaseRowMembers) 으로 pageId 를 좁힌 뒤
 * Pages BatchGet(100개 청크) 으로 실제 row 를 가져온다. org/team/project 동시 지정 시 post-filter.
 * nextToken 은 member 인덱스 Query 의 LastEvaluatedKey 를 사용한다.
 */
async function listDatabaseRowsByAssignee(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  databaseId: string;
  workspaceId: string;
  assigneeId: string;
  organizationId?: string;
  teamId?: string;
  projectId?: string;
  limit: number;
}): Promise<Connection<Record<string, unknown>>> {
  const memberTable = args.tables.DatabaseRowMembers;
  // 색인 테이블 미설정이면 빈 결과(회귀 없이 graceful) — scope 미지정 경로는 별도 처리됨.
  if (!memberTable || !args.tables.Pages) return { items: [], nextToken: null };

  const indexRes = await args.doc.send(
    new QueryCommand({
      TableName: memberTable,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": `${args.databaseId}#${args.assigneeId}` },
      Limit: args.limit,
    }),
  );
  const indexItems = (indexRes.Items ?? []) as Array<Record<string, unknown>>;
  const pageIds = Array.from(
    new Set(
      indexItems
        .map((item) => item.pageId)
        .filter((id): id is string => typeof id === "string"),
    ),
  );
  if (!pageIds.length) {
    return {
      items: [],
      nextToken: indexRes.LastEvaluatedKey ? JSON.stringify(indexRes.LastEvaluatedKey) : null,
    };
  }

  // Pages BatchGet — 100개 청크.
  const fetched: Array<Record<string, unknown>> = [];
  for (let i = 0; i < pageIds.length; i += 100) {
    const chunk = pageIds.slice(i, i + 100);
    const res = await args.doc.send(
      new BatchGetCommand({
        RequestItems: {
          [args.tables.Pages]: { Keys: chunk.map((id) => ({ id })) },
        },
      }),
    );
    const got = (res.Responses?.[args.tables.Pages] ?? []) as Array<Record<string, unknown>>;
    fetched.push(...got);
  }

  const scopeColumns = resolveProtectedDbScopeColumnIds(args.databaseId);
  const filtered = fetched.filter((page) => {
    if (page.workspaceId !== args.workspaceId) return false;
    // 미삭제만.
    const deletedAt = page.deletedAt;
    if (typeof deletedAt === "string" && deletedAt !== "") return false;
    // org/team/project 동시 지정 시 dbCells scope 일치 post-filter (우선순위 project>team>org).
    if (scopeColumns) {
      if (args.projectId) {
        return pageScopeValue(page, scopeColumns.project) === args.projectId;
      }
      if (args.teamId) {
        return pageScopeValue(page, scopeColumns.team) === args.teamId;
      }
      if (args.organizationId) {
        return pageScopeValue(page, scopeColumns.organization) === args.organizationId;
      }
    }
    return true;
  });

  // order(문자열 숫자) 기준 정렬 — 안정적 표시 순서.
  filtered.sort((a, b) => {
    const ao = Number(a.order);
    const bo = Number(b.order);
    if (Number.isFinite(ao) && Number.isFinite(bo) && ao !== bo) return ao - bo;
    return String(a.order ?? "").localeCompare(String(b.order ?? ""));
  });

  return {
    items: filtered,
    nextToken: indexRes.LastEvaluatedKey ? JSON.stringify(indexRes.LastEvaluatedKey) : null,
  };
}

export async function listDatabaseRows(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  databaseId: string;
  workspaceId: string;
  organizationId?: string;
  teamId?: string;
  projectId?: string;
  assigneeId?: string;
  limit?: number;
  nextToken?: string;
}): Promise<Connection<Record<string, unknown>>> {
  if (!args.tables.Pages) badRequest("Pages table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 200);

  // 우선순위: assigneeId(구성원 색인) > project/team/org(scope GSI) > 기존 byDatabaseAndOrder.
  if (args.assigneeId) {
    return listDatabaseRowsByAssignee({
      doc: args.doc,
      tables: args.tables,
      databaseId: args.databaseId,
      workspaceId: args.workspaceId,
      assigneeId: args.assigneeId,
      organizationId: args.organizationId,
      teamId: args.teamId,
      projectId: args.projectId,
      limit,
    });
  }

  // scope 우선순위: project > team > organization (먼저 지정된 것 하나만 적용).
  // scope 지정 시 해당 비정규화 GSI(dbScope*) 로 ${databaseId}#${scopeId} 키만 조회해 비용 절감.
  let indexName = "byDatabaseAndOrder";
  let keyCondition = "databaseId = :d";
  let keyValue = args.databaseId;
  if (args.projectId) {
    indexName = "byDbScopeProject";
    keyCondition = "dbScopeProject = :d";
    keyValue = `${args.databaseId}#${args.projectId}`;
  } else if (args.teamId) {
    indexName = "byDbScopeTeam";
    keyCondition = "dbScopeTeam = :d";
    keyValue = `${args.databaseId}#${args.teamId}`;
  } else if (args.organizationId) {
    indexName = "byDbScopeOrg";
    keyCondition = "dbScopeOrg = :d";
    keyValue = `${args.databaseId}#${args.organizationId}`;
  }

  const r = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.Pages,
      IndexName: indexName,
      KeyConditionExpression: keyCondition,
      FilterExpression: "workspaceId = :w AND (attribute_not_exists(deletedAt) OR attribute_type(deletedAt, :nullType) OR deletedAt = :empty)",
      ExpressionAttributeValues: {
        ":d": keyValue,
        ":w": args.workspaceId,
        ":empty": "",
        ":nullType": "NULL",
      },
      ScanIndexForward: true,
      Limit: limit,
      ExclusiveStartKey: args.nextToken ? JSON.parse(args.nextToken) : undefined,
    }),
  );
  return {
    items: (r.Items ?? []) as Record<string, unknown>[],
    nextToken: r.LastEvaluatedKey ? JSON.stringify(r.LastEvaluatedKey) : null,
  };
}

/**
 * LC 보호 DB(작업/마일스톤/피처) row 의 org/팀/프로젝트 scope 컬럼 ID 접두사.
 * databaseId 접두사로 어떤 보호 DB 인지 판별해 대응되는 컬럼 ID 셋을 반환한다.
 * - 작업(lc-scheduler-db:) → lc-scheduler:*
 * - 마일스톤(lc-milestone-db:) → lc-milestone:*
 * - 피처(lc-feature-db:) → lc-feature:*
 */
const LC_PROTECTED_DB_SCOPE_COLUMN_IDS: ReadonlyArray<{
  prefix: string;
  organization: string;
  team: string;
  project: string;
}> = [
  {
    prefix: "lc-scheduler-db:",
    organization: "lc-scheduler:organization",
    team: "lc-scheduler:team",
    project: "lc-scheduler:project",
  },
  {
    prefix: "lc-milestone-db:",
    organization: "lc-milestone:organization",
    team: "lc-milestone:team",
    project: "lc-milestone:project",
  },
  {
    prefix: "lc-feature-db:",
    organization: "lc-feature:organization",
    team: "lc-feature:team",
    project: "lc-feature:project",
  },
];

function resolveProtectedDbScopeColumnIds(
  databaseId: unknown,
): { organization: string; team: string; project: string } | null {
  if (typeof databaseId !== "string") return null;
  for (const entry of LC_PROTECTED_DB_SCOPE_COLUMN_IDS) {
    if (databaseId.startsWith(entry.prefix)) {
      return { organization: entry.organization, team: entry.team, project: entry.project };
    }
  }
  return null;
}

/** dbCells(문자열 또는 객체)에서 단일 scope 셀 값을 문자열로 읽는다. 없으면 null. */
function readScopeCellValue(cells: Record<string, unknown>, columnId: string): string | null {
  const raw = cells[columnId];
  if (raw == null) return null;
  // select 셀은 보통 문자열(옵션 id)이지만, 객체/배열 형태일 수도 있어 방어적으로 처리한다.
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return null;
}

/**
 * 보호 DB row 의 비정규화 scope 키(dbScopeOrg/Team/Project)를 input 에 세팅한다.
 * 형식: `${databaseId}#${scopeId}`. 값이 없으면 속성을 넣지 않아 sparse GSI 에서 제외한다.
 * 비-보호 DB row 는 건드리지 않는다(scope 컬럼 셋이 없으면 즉시 반환).
 */
export function deriveDatabaseRowScopeKeys(input: Record<string, unknown>): void {
  const databaseId = input.databaseId;
  const scopeColumns = resolveProtectedDbScopeColumnIds(databaseId);
  // 빈 문자열/null GSI 키 금지 — 항상 먼저 기존 scope 속성을 제거하고, 유효 값만 다시 세팅한다.
  delete input.dbScopeOrg;
  delete input.dbScopeTeam;
  delete input.dbScopeProject;
  if (!scopeColumns || typeof databaseId !== "string") return;

  // dbCells 는 AWSJSON — 문자열이면 파싱, 파싱 실패 시 scope 키 생략.
  let cells: Record<string, unknown> | null = null;
  const rawCells = input.dbCells;
  if (typeof rawCells === "string") {
    try {
      const parsed = JSON.parse(rawCells) as unknown;
      cells = isPlainObject(parsed) ? parsed : null;
    } catch {
      cells = null;
    }
  } else if (isPlainObject(rawCells)) {
    cells = rawCells;
  }
  if (!cells) return;

  const org = readScopeCellValue(cells, scopeColumns.organization);
  const team = readScopeCellValue(cells, scopeColumns.team);
  const project = readScopeCellValue(cells, scopeColumns.project);
  if (org != null) input.dbScopeOrg = `${databaseId}#${org}`;
  if (team != null) input.dbScopeTeam = `${databaseId}#${team}`;
  if (project != null) input.dbScopeProject = `${databaseId}#${project}`;
}

/**
 * order 를 byDatabaseAndOrder GSI sort key(STRING, non-null)에 적합하게 보정한다.
 * 유효한 숫자 문자열이면 그대로 두고, 아니면 createdAt→updatedAt epoch ms 문자열로 채운다.
 */
export function normalizePageOrderField(input: Record<string, unknown>): void {
  const order = input.order;
  if (typeof order === "string" && order !== "" && !Number.isNaN(Number(order))) {
    return;
  }
  for (const key of ["createdAt", "updatedAt"]) {
    const v = input[key];
    if (typeof v === "string" && v) {
      const ms = Date.parse(v);
      if (!Number.isNaN(ms)) {
        input.order = String(ms);
        return;
      }
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      input.order = String(v);
      return;
    }
  }
  input.order = "0";
}
