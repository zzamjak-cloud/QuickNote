import {
  BatchWriteCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import type { Tables } from "./member";

// 구성원(assignee)별 DB row 색인 — listDatabaseRows 의 assigneeId 필터를 위한 전용 인덱스.
// lcScheduleIndex.ts 패턴을 차용하되, period(기간) 조건 없이 작업 DB 의 모든 row 를 색인한다.
// (스케줄 인덱스는 기간이 있는 일정만 색인하지만, 여기서는 row 단위 필터링이 목적이므로 전부 색인.)

const LC_SCHEDULER_WORKSPACE_ID = "lc-scheduler-global";
const LC_SCHEDULER_DATABASE_ID_PREFIX = "lc-scheduler-db:";
const INSTANCE_SEPARATOR = "::";

// member 인덱스는 작업 DB(lc-scheduler-db:)의 assignees 컬럼만 대상으로 한다.
// (마일스톤/피처 DB 는 assignees 의미가 다를 수 있어 제외 — org/team/project GSI 만 적용.)
const COL = {
  assignees: "lc-scheduler:assignees",
} as const;

export type LCDatabaseRowMemberRecord = {
  /** `${pageId}::${memberId}` — 단일 row+구성원 조합의 유일 식별자(베이스 테이블 PK 아님, 참고용). */
  id: string;
  /** 파티션 키: `${databaseId}#${memberId}` */
  pk: string;
  /** 정렬 키: pageId */
  pageId: string;
  databaseId: string;
  memberId: string;
  /** Pages.order 와 동일 — BatchGet 후 정렬 보조용. */
  order: string;
  workspaceId: string;
  updatedAt: string;
};

type SyncArgs = {
  doc: DynamoDBDocumentClient;
  tables: Pick<Tables, "DatabaseRowMembers">;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

function parseObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeAssignees(value: unknown): string[] {
  const raw: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      const assignee = asString(item);
      if (assignee) raw.push(assignee);
    }
  } else if (typeof value === "string") {
    raw.push(...value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean));
  }
  return Array.from(new Set(raw));
}

function isLCSchedulerTaskPage(page: Record<string, unknown>): boolean {
  return (
    page.workspaceId === LC_SCHEDULER_WORKSPACE_ID &&
    typeof page.databaseId === "string" &&
    page.databaseId.startsWith(LC_SCHEDULER_DATABASE_ID_PREFIX)
  );
}

/** 작업 DB row 의 assignees 마다 색인 레코드를 만든다. 기간 조건 없음. */
export function buildLCDatabaseRowMemberRecords(
  page: Record<string, unknown>,
  options: { includeDeleted?: boolean } = {},
): LCDatabaseRowMemberRecord[] {
  if (!isLCSchedulerTaskPage(page)) return [];
  if (page.deletedAt && !options.includeDeleted) return [];

  const pageId = asString(page.id);
  const databaseId = asString(page.databaseId);
  if (!pageId || !databaseId) return [];

  const cells = parseObject(page.dbCells) ?? {};
  if (cells["_qn_isTemplate"] === "1") return [];
  const assignees = normalizeAssignees(cells[COL.assignees]);
  if (!assignees.length) return [];

  const order = asString(page.order) ?? "0";
  const updatedAt = asString(page.updatedAt) ?? new Date(0).toISOString();

  return assignees.map((memberId) => ({
    id: `${pageId}${INSTANCE_SEPARATOR}${memberId}`,
    pk: `${databaseId}#${memberId}`,
    pageId,
    databaseId,
    memberId,
    order,
    workspaceId: LC_SCHEDULER_WORKSPACE_ID,
    updatedAt,
  }));
}

async function writeMemberIndexBatch(
  doc: DynamoDBDocumentClient,
  tableName: string,
  requests: NonNullable<
    ConstructorParameters<typeof BatchWriteCommand>[0]["RequestItems"]
  >[string],
): Promise<void> {
  for (let i = 0; i < requests.length; i += 25) {
    const chunk = requests.slice(i, i + 25);
    if (!chunk.length) continue;
    await doc.send(
      new BatchWriteCommand({ RequestItems: { [tableName]: chunk } }),
    );
  }
}

export async function syncLCDatabaseRowMemberIndexForPage(args: SyncArgs): Promise<void> {
  const tableName = args.tables.DatabaseRowMembers;
  if (!tableName) return;
  const before = args.before ? buildLCDatabaseRowMemberRecords(args.before) : [];
  const after = args.after ? buildLCDatabaseRowMemberRecords(args.after) : [];
  const afterKeys = new Set(after.map((record) => `${record.pk}|${record.pageId}`));
  const requests = [
    ...before
      .filter((record) => !afterKeys.has(`${record.pk}|${record.pageId}`))
      .map((record) => ({
        DeleteRequest: { Key: { pk: record.pk, pageId: record.pageId } },
      })),
    ...after.map((record) => ({ PutRequest: { Item: record } })),
  ];
  if (!requests.length) return;
  await writeMemberIndexBatch(args.doc, tableName, requests);
}

export async function removeLCDatabaseRowMemberIndexForPage(args: {
  doc: DynamoDBDocumentClient;
  tables: Pick<Tables, "DatabaseRowMembers">;
  page: Record<string, unknown>;
}): Promise<void> {
  const tableName = args.tables.DatabaseRowMembers;
  if (!tableName) return;
  const existing = buildLCDatabaseRowMemberRecords(args.page, { includeDeleted: true });
  const requests = existing.map((record) => ({
    DeleteRequest: { Key: { pk: record.pk, pageId: record.pageId } },
  }));
  if (!requests.length) return;
  await writeMemberIndexBatch(args.doc, tableName, requests);
}
