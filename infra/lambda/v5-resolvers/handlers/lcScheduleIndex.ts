import {
  BatchWriteCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import type { Tables } from "./member";

const LC_SCHEDULER_WORKSPACE_ID = "lc-scheduler-global";
const LC_SCHEDULER_DATABASE_ID_PREFIX = "lc-scheduler-db:";
const INSTANCE_SEPARATOR = "::";
const GLOBAL_ASSIGNEE_ID = "__global__";

const COL = {
  title: "lc-scheduler:title",
  assignees: "lc-scheduler:assignees",
  period: "lc-scheduler:period",
  project: "lc-scheduler:project",
  status: "lc-scheduler:status",
  attendance: "lc-scheduler:attendance",
  organization: "lc-scheduler:organization",
  team: "lc-scheduler:team",
  color: "lc-scheduler:color",
  meta: "lc-scheduler:meta",
} as const;

type DateRange = { start: string; end: string };

export type LCScheduleIndexRecord = {
  id: string;
  sourcePageId: string;
  workspaceId: string;
  title: string;
  startAt: string;
  endAt: string;
  assigneeId?: string;
  projectId?: string;
  teamId?: string;
  organizationId?: string;
  kind?: "schedule" | "leave";
  color?: string;
  textColor?: string;
  rowIndex?: number;
  createdByMemberId: string;
  createdAt: string;
  updatedAt: string;
};

type SyncArgs = {
  doc: DynamoDBDocumentClient;
  tables: Pick<Tables, "Schedules">;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

function parseObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asDateRange(value: unknown): DateRange | null {
  const record = parseObject(value);
  const start = asString(record?.start);
  if (!start) return null;
  return {
    start,
    end: asString(record?.end) ?? start,
  };
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

function scheduleIndexId(pageId: string, assigneeId: string | null): string {
  return `${pageId}${INSTANCE_SEPARATOR}${assigneeId ?? GLOBAL_ASSIGNEE_ID}`;
}

function isLCSchedulerPage(page: Record<string, unknown>): boolean {
  return (
    page.workspaceId === LC_SCHEDULER_WORKSPACE_ID &&
    typeof page.databaseId === "string" &&
    page.databaseId.startsWith(LC_SCHEDULER_DATABASE_ID_PREFIX)
  );
}

function rowIndexFromMeta(meta: Record<string, unknown> | null, assigneeId: string | null): number {
  const rowMap = parseObject(meta?.rowIndexByAssigneeId);
  const key = assigneeId ?? GLOBAL_ASSIGNEE_ID;
  const value = rowMap?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function kindFromCells(cells: Record<string, unknown>, meta: Record<string, unknown> | null): "schedule" | "leave" {
  if (asString(cells[COL.attendance])) return "leave";
  if (asString(cells[COL.status]) === "leave") return "leave";
  return meta?.kind === "leave" ? "leave" : "schedule";
}

export function buildLCScheduleIndexRecords(
  page: Record<string, unknown>,
  options: { includeDeleted?: boolean } = {},
): LCScheduleIndexRecord[] {
  if (!isLCSchedulerPage(page)) return [];
  if (page.deletedAt && !options.includeDeleted) return [];

  const cells = parseObject(page.dbCells) ?? {};
  if (cells["_qn_isTemplate"] === "1") return [];
  const range = asDateRange(cells[COL.period]);
  if (!range) return [];

  const pageId = asString(page.id);
  if (!pageId) return [];

  const meta = parseObject(cells[COL.meta]);
  const assignees = normalizeAssignees(cells[COL.assignees]);
  const assigneeIds = assignees.length ? assignees : [null];
  const title = asString(cells[COL.title]) ?? asString(page.title) ?? "일정";
  const projectId = asString(cells[COL.project]);
  const teamId = asString(cells[COL.team]);
  const organizationId = asString(cells[COL.organization]);
  const color = asString(cells[COL.color]);
  const textColor = asString(meta?.textColor);
  const kind = kindFromCells(cells, meta);
  const createdByMemberId = asString(page.createdByMemberId) ?? "";
  const createdAt = asString(page.createdAt) ?? new Date(0).toISOString();
  const updatedAt = asString(page.updatedAt) ?? createdAt;

  return assigneeIds.map((assigneeId) => ({
    id: scheduleIndexId(pageId, assigneeId),
    sourcePageId: pageId,
    workspaceId: LC_SCHEDULER_WORKSPACE_ID,
    title,
    startAt: range.start,
    endAt: range.end,
    ...(assigneeId ? { assigneeId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(teamId ? { teamId } : {}),
    ...(organizationId ? { organizationId } : {}),
    kind,
    ...(color ? { color } : {}),
    ...(textColor ? { textColor } : {}),
    rowIndex: rowIndexFromMeta(meta, assigneeId),
    createdByMemberId,
    createdAt,
    updatedAt,
  }));
}

async function writeScheduleIndexBatch(
  doc: DynamoDBDocumentClient,
  tableName: string,
  requests: NonNullable<ConstructorParameters<typeof BatchWriteCommand>[0]["RequestItems"]>[string],
): Promise<void> {
  for (let i = 0; i < requests.length; i += 25) {
    const chunk = requests.slice(i, i + 25);
    if (!chunk.length) continue;
    await doc.send(new BatchWriteCommand({
      RequestItems: {
        [tableName]: chunk,
      },
    }));
  }
}

export async function syncLCScheduleIndexForPage(args: SyncArgs): Promise<void> {
  const tableName = args.tables.Schedules;
  if (!tableName) return;
  const before = args.before ? buildLCScheduleIndexRecords(args.before) : [];
  const after = args.after ? buildLCScheduleIndexRecords(args.after) : [];
  const afterIds = new Set(after.map((record) => record.id));
  const requests = [
    ...before
      .filter((record) => !afterIds.has(record.id))
      .map((record) => ({ DeleteRequest: { Key: { id: record.id } } })),
    ...after.map((record) => ({ PutRequest: { Item: record } })),
  ];
  if (!requests.length) return;
  await writeScheduleIndexBatch(args.doc, tableName, requests);
}

export async function removeLCScheduleIndexForPage(args: {
  doc: DynamoDBDocumentClient;
  tables: Pick<Tables, "Schedules">;
  page: Record<string, unknown>;
}): Promise<void> {
  const tableName = args.tables.Schedules;
  if (!tableName) return;
  const existing = buildLCScheduleIndexRecords(args.page, { includeDeleted: true });
  const requests = existing.map((record) => ({ DeleteRequest: { Key: { id: record.id } } }));
  if (!requests.length) return;
  await writeScheduleIndexBatch(args.doc, tableName, requests);
}
