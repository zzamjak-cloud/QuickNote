// 스케줄러 일정 툴 — 일정은 고정 작업 DB(lc-scheduler-db:lc-scheduler-global)의 행이다.
// 저장은 범용 쓰기와 같은 경로(saveNewPage/patchPage → upsertPage 가 Schedules·DatabaseRowMembers·dbScope 색인 유지,
// DB 룸 셀 기록·브로드캐스트, publishPageChanged). 레거시 createSchedule/updateSchedule 리졸버는 클라에 보이지 않아 쓰지 않는다.
import { randomUUID } from "node:crypto";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import {
  LC_SCHEDULER_ATTENDANCE_OPTIONS,
  LC_SCHEDULER_COLUMN_IDS as COL,
  LC_SCHEDULER_DATABASE_ID,
  normalizeLCSchedulerAttendanceValue,
  parseScheduleInstanceId,
} from "../../../../../src/lib/scheduler/schedulerSchema";
import { getSchedulerTaskCardColor, parseSchedulerTaskMeta } from "../../../../../src/lib/scheduler/taskMeta";
import { softDeletePage } from "../../../v5-resolvers/handlers/pageDatabase";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../../v5-resolvers/handlers/_auth";
import { buildLCScheduleIndexRecords } from "../../../v5-resolvers/handlers/lcScheduleIndex";
import { requireWorkspace } from "../../access";
import { mergeCells, resolveWorkspaceMember } from "../../cellInput";
import { ToolError, type McpContext } from "../../context";
import { readDbRoomRoot, removeDbRow, writeDbRowCells } from "../../dbCollabWriter";
import { batchGetByKey, getItem } from "../../ddb";
import { requireCollabEpoch } from "../../epochGuard";
import { invalidateWorkspaceMetas } from "../../pageScan";
import { prepareNewDoc } from "../../pageHelpers";
import { nowIso, patchPage, saveNewPage } from "../../pageWrite";
import { loadMemberNames, parseCells } from "../../properties";
import { publishPage } from "../../publish";
import { requireSchedulerWrite } from "../../writeAccess";
import {
  SCHEDULE_STATUSES,
  assertYmd,
  assigneeIdsOf,
  buildCreateCells,
  buildUpdateCells,
  kstEndIso,
  kstStartIso,
  kstYmd,
  shiftYmd,
} from "./scheduleCells";

type Item = Record<string, unknown>;

const ATTENDANCE_IDS = LC_SCHEDULER_ATTENDANCE_OPTIONS.map((o) => o.id) as [string, ...string[]];
const HEX = /^#[0-9a-fA-F]{6}$/;
const idString = z.string().trim().min(1).max(256);
const ymd = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const hex = z.string().trim().regex(HEX, "expected #RRGGBB");
/** 긴 기간 일정은 시작일이 조회 범위 앞에 있을 수 있어 Schedules 색인을 이만큼 앞서 읽는다. */
const LOOKBACK_DAYS = 366;
const MAX_RANGE_DAYS = 366;
const MAX_INDEX_ITEMS = 5000;
const INDEX_PAGE = 500;

const scheduleFields = {
  title: z.string().max(500).optional().describe('Card title. "근태"/"연차" (or attendance) creates an attendance (leave) card'),
  startDate: ymd.optional().describe("First day, YYYY-MM-DD (Korea time)"),
  endDate: ymd.optional().describe("Last day (inclusive), YYYY-MM-DD; defaults to startDate"),
  projectId: idString.nullable().optional().describe("Scheduler project id (list_scheduler_projects); null clears"),
  organizationId: idString.nullable().optional().describe("Organization id; null clears"),
  teamId: idString.nullable().optional().describe("Team id; null clears"),
  status: z.enum(SCHEDULE_STATUSES).optional()
    .describe("todo/progress/done/hold. Omit to let QuickNote set it from today vs. the period (hold and attendance cards are never auto-changed)"),
  attendance: z.enum(ATTENDANCE_IDS).nullable().optional()
    .describe(`Attendance type for leave cards: ${LC_SCHEDULER_ATTENDANCE_OPTIONS.map((o) => `${o.id}(${o.label})`).join(", ")}`),
  color: hex.nullable().optional().describe("Card color #RRGGBB"),
  textColor: hex.nullable().optional().describe("Card text color #RRGGBB (default: contrast of color)"),
  rowIndex: z.number().int().min(0).max(50).optional().describe("Lane index inside the assignee row (default 0)"),
  milestoneId: idString.nullable().optional().describe("Milestone row page id (milestone DB)"),
  featureId: idString.nullable().optional().describe("Feature row page id (feature DB)"),
};

export const listSchedulesInputShape = {
  from: ymd.describe("Range start YYYY-MM-DD (Korea time, inclusive)"),
  to: ymd.optional().describe("Range end YYYY-MM-DD (inclusive, default = from, max 366 days)"),
  assignee: z.string().trim().min(1).max(320).optional().describe("Only this member (id or email)"),
  projectId: idString.optional(),
  organizationId: idString.optional(),
  teamId: idString.optional(),
  kind: z.enum(["schedule", "leave"]).optional().describe("Only regular schedules or only attendance (leave) cards"),
  limit: z.number().int().min(1).max(500).optional().describe("Max cards (default 200)"),
};
const listSchedulesInput = z.object(listSchedulesInputShape);

export const createScheduleInputShape = {
  ...scheduleFields,
  startDate: ymd.describe("First day, YYYY-MM-DD (Korea time)"),
  assignee: z.string().trim().min(1).max(320).nullable().optional()
    .describe("Member id or email. Omit/null = a team-wide special event (no assignee)"),
};
const createScheduleInput = z.object(createScheduleInputShape).strict();

export const updateScheduleInputShape = {
  id: idString.describe('Card id from list_schedules ("<pageId>::<assigneeId>" or "<pageId>::__global__")'),
  ...scheduleFields,
  assignee: z.string().trim().min(1).max(320).nullable().optional()
    .describe("Move this card to another member (id or email); null removes all assignees (special event)"),
  colorScope: z.enum(["row", "card"]).optional()
    .describe("row = color of the whole row; card = only this assignee's card (default for multi-assignee rows)"),
};
const updateScheduleInput = z.object(updateScheduleInputShape).strict();

export const deleteScheduleInputShape = {
  id: idString.describe("Card id from list_schedules or the row page id. Trashes the whole row (all assignees' cards)"),
};
const deleteScheduleInput = z.object(deleteScheduleInputShape).strict();

export type ScheduleCard = {
  id: string;
  pageId: string;
  title: string;
  kind: "schedule" | "leave";
  status: string | null;
  attendance: string | null;
  startDate: string;
  endDate: string;
  startAt: string;
  endAt: string;
  assigneeId: string | null;
  assigneeName?: string;
  projectId: string | null;
  organizationId: string | null;
  teamId: string | null;
  color: string | null;
  rowIndex: number;
  milestoneIds: string[];
  featureIds: string[];
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function idList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v !== "") : [];
}

/** 행 페이지 → 카드(담당자별 인스턴스). 서버 Schedules 색인(buildLCScheduleIndexRecords)과 같은 투영 + 상태·근태·링크. */
export function scheduleCardsOf(page: Item): ScheduleCard[] {
  const cells = parseCells(page.dbCells);
  const meta = parseSchedulerTaskMeta(cells[COL.meta]);
  return buildLCScheduleIndexRecords({ ...page, dbCells: cells }).map((r) => ({
    id: r.id,
    pageId: r.sourcePageId,
    title: r.title,
    kind: r.kind ?? "schedule",
    status: asString(cells[COL.status]),
    attendance: normalizeLCSchedulerAttendanceValue(asString(cells[COL.attendance])),
    startDate: kstYmd(r.startAt),
    endDate: kstYmd(r.endAt),
    startAt: r.startAt,
    endAt: r.endAt,
    assigneeId: r.assigneeId ?? null,
    projectId: r.projectId ?? null,
    organizationId: r.organizationId ?? null,
    teamId: r.teamId ?? null,
    color: getSchedulerTaskCardColor(meta, r.assigneeId ?? null) ?? r.color ?? null,
    rowIndex: r.rowIndex ?? 0,
    milestoneIds: idList(cells[COL.milestone]),
    featureIds: idList(cells[COL.feature]),
  }));
}

async function withNames(ctx: McpContext, cards: ScheduleCard[]): Promise<ScheduleCard[]> {
  const names = await loadMemberNames(ctx.doc, ctx.tables.Members, [...new Set(cards.map((c) => c.assigneeId).filter((id): id is string => Boolean(id)))]);
  return cards.map((c) => (c.assigneeId && names.has(c.assigneeId) ? { ...c, assigneeName: names.get(c.assigneeId) } : c));
}

async function resolveAssignee(ctx: McpContext, ref: string): Promise<string> {
  const id = await resolveWorkspaceMember(ctx, ref, LC_SCHEDULER_WORKSPACE_ID);
  if (!id) throw new ToolError(`Unknown or inactive member "${ref}" (use get_users for ids/emails)`);
  return id;
}

/** 프로젝트·마일스톤·피처 참조 검증 — 없는 id 를 셀에 쓰면 앱에서 빈 값으로 보인다. */
async function assertReferences(ctx: McpContext, input: { projectId?: string | null; milestoneId?: string | null; featureId?: string | null }): Promise<void> {
  if (input.projectId) {
    const project = await getItem(ctx.doc, ctx.tables.Projects, { id: input.projectId, workspaceId: LC_SCHEDULER_WORKSPACE_ID });
    if (!project) throw new ToolError(`Unknown scheduler project "${input.projectId}" (use list_scheduler_projects)`);
  }
  for (const [field, id, prefix] of [["milestoneId", input.milestoneId, "lc-milestone-db:"], ["featureId", input.featureId, "lc-feature-db:"]] as const) {
    if (!id) continue;
    const page = await getItem(ctx.doc, ctx.tables.Pages, { id });
    const ok = page && !page.deletedAt && typeof page.databaseId === "string" && page.databaseId.startsWith(prefix);
    if (!ok) throw new ToolError(`${field} "${id}" is not a row of the ${field === "milestoneId" ? "milestone" : "feature"} database`);
  }
}

function assertDates(input: { startDate?: string; endDate?: string }): void {
  if (input.startDate) assertYmd(input.startDate, "startDate");
  if (input.endDate) assertYmd(input.endDate, "endDate");
  if (input.startDate && input.endDate && input.endDate < input.startDate) throw new ToolError("endDate must be on or after startDate");
}

// ---------- list_schedules ----------

async function queryIndex(ctx: McpContext, fromIso: string, toIso: string): Promise<{ items: Item[]; truncated: boolean }> {
  const items: Item[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const r = await ctx.doc.send(new QueryCommand({
      TableName: ctx.tables.Schedules,
      IndexName: "byWorkspaceAndStartAt",
      KeyConditionExpression: "workspaceId = :w AND startAt BETWEEN :lo AND :hi",
      ExpressionAttributeValues: { ":w": LC_SCHEDULER_WORKSPACE_ID, ":lo": shiftIso(fromIso, -LOOKBACK_DAYS), ":hi": toIso },
      ProjectionExpression: "sourcePageId, startAt, endAt",
      Limit: INDEX_PAGE,
      ...(cursor ? { ExclusiveStartKey: cursor } : {}),
    }));
    items.push(...((r.Items ?? []) as Item[]));
    cursor = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (cursor && items.length < MAX_INDEX_ITEMS);
  return { items, truncated: Boolean(cursor) };
}

function shiftIso(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}

export async function listSchedulesTool(ctx: McpContext, raw: z.input<typeof listSchedulesInput>) {
  const input = listSchedulesInput.parse(raw);
  await requireWorkspace(ctx, LC_SCHEDULER_WORKSPACE_ID);
  const to = input.to ?? input.from;
  assertDates({ startDate: input.from, endDate: to });
  if (to > shiftYmd(input.from, MAX_RANGE_DAYS)) throw new ToolError(`Range is at most ${MAX_RANGE_DAYS} days`);
  const fromIso = kstStartIso(input.from);
  const toIso = kstEndIso(to);
  const assigneeId = input.assignee ? await resolveAssignee(ctx, input.assignee) : null;

  // 색인은 후보 찾기에만 쓰고, 카드는 최신 행 페이지에서 투영한다(상태·근태·휴지통 반영).
  const { items, truncated } = await queryIndex(ctx, fromIso, toIso);
  const pageIds = [...new Set(items.filter((it) => String(it.endAt ?? it.startAt) >= fromIso).map((it) => String(it.sourcePageId ?? "")).filter(Boolean))];
  const pages = await batchGetByKey({
    doc: ctx.doc, tableName: ctx.tables.Pages, keyName: "id", ids: pageIds,
    projection: "id, workspaceId, databaseId, title, dbCells, deletedAt, createdByMemberId, createdAt, updatedAt",
  });
  const limit = input.limit ?? 200;
  const cards = pages
    .filter((p) => !p.deletedAt && p.databaseId === LC_SCHEDULER_DATABASE_ID)
    .flatMap(scheduleCardsOf)
    .filter((c) => c.startAt <= toIso && c.endAt >= fromIso)
    .filter((c) => (!assigneeId || c.assigneeId === assigneeId)
      && (!input.projectId || c.projectId === input.projectId)
      && (!input.organizationId || c.organizationId === input.organizationId)
      && (!input.teamId || c.teamId === input.teamId)
      && (!input.kind || c.kind === input.kind))
    .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
  return {
    from: input.from,
    to,
    total: cards.length,
    schedules: await withNames(ctx, cards.slice(0, limit)),
    ...(cards.length > limit ? { truncated: true, note: `Showing ${limit} of ${cards.length}; narrow the range or filters` } : {}),
    ...(truncated ? { indexTruncated: true } : {}),
  };
}

// ---------- create_schedule ----------

async function loadSchedulerDatabase(ctx: McpContext): Promise<Item> {
  const db = await getItem(ctx.doc, ctx.tables.Databases, { id: LC_SCHEDULER_DATABASE_ID });
  if (!db || db.deletedAt) throw new ToolError("The scheduler task database is not initialized; open the scheduler in QuickNote once");
  return db;
}

export async function createScheduleTool(ctx: McpContext, raw: z.input<typeof createScheduleInput>) {
  const input = createScheduleInput.parse(raw);
  await requireSchedulerWrite(ctx);
  assertDates(input);
  const assigneeId = input.assignee ? await resolveAssignee(ctx, input.assignee) : null;
  await assertReferences(ctx, input);
  const db = await loadSchedulerDatabase(ctx);
  await requireCollabEpoch(ctx);

  const { title, cells } = buildCreateCells(db.presets, {
    ...input,
    attendance: input.attendance === undefined ? undefined : normalizeLCSchedulerAttendanceValue(input.attendance),
    assigneeId,
  }, Date.now());
  const id = randomUUID();
  const now = nowIso();
  const { page } = await saveNewPage(ctx, {
    id,
    workspaceId: LC_SCHEDULER_WORKSPACE_ID,
    createdByMemberId: ctx.caller.memberId,
    title,
    parentId: null,
    // 스케줄러 카드 배치는 기간·rowIndex 로 정해진다. 행 순서는 DB 룸 rowPageOrder(끝에 추가)가 권위라
    // 대용량 워크스페이스 메타 스캔 없이 생성 시각을 order 로 쓴다(숫자 정렬상 기존 행 뒤).
    order: String(Date.now()),
    databaseId: LC_SCHEDULER_DATABASE_ID,
    doc: JSON.stringify(prepareNewDoc(null)),
    dbCells: JSON.stringify(cells),
    createdAt: now,
    updatedAt: now,
  });
  const cellsWrittenTo = await writeDbRowCells(ctx, LC_SCHEDULER_DATABASE_ID, id, cells, { newRow: true });
  return { created: await withNames(ctx, scheduleCardsOf(page)), cellsWrittenTo };
}

// ---------- update_schedule ----------

async function loadScheduleRow(ctx: McpContext, id: string): Promise<{ page: Item; assigneeId: string | null }> {
  const parsed = parseScheduleInstanceId(id);
  const pageId = parsed?.pageId ?? id;
  const page = await getItem(ctx.doc, ctx.tables.Pages, { id: pageId });
  if (!page || page.workspaceId !== LC_SCHEDULER_WORKSPACE_ID || page.databaseId !== LC_SCHEDULER_DATABASE_ID) {
    throw new ToolError("Schedule not found (use list_schedules for card ids)");
  }
  if (page.deletedAt) throw new ToolError("This schedule is in the trash");
  if (parseCells(page.dbCells)._qn_isTemplate === "1") throw new ToolError("Template rows cannot be changed via MCP");
  return { page, assigneeId: parsed?.assigneeId ?? null };
}

/** 셀 권위는 DB 룸 — 룸에 행이 있으면 그 셀, 없으면 Pages.dbCells. */
async function currentCells(ctx: McpContext, page: Item): Promise<Record<string, unknown>> {
  const root = await readDbRoomRoot(ctx, LC_SCHEDULER_DATABASE_ID);
  const rows = root?.rows as Record<string, unknown> | undefined;
  const roomRow = rows?.[String(page.id)];
  return roomRow && typeof roomRow === "object" && !Array.isArray(roomRow) ? (roomRow as Record<string, unknown>) : parseCells(page.dbCells);
}

export async function updateScheduleTool(ctx: McpContext, raw: z.input<typeof updateScheduleInput>) {
  const input = updateScheduleInput.parse(raw);
  const { id: _id, assignee, ...fields } = input;
  if (Object.values(fields).every((v) => v === undefined) && assignee === undefined) {
    throw new ToolError("Nothing to update");
  }
  await requireSchedulerWrite(ctx);
  assertDates(input);
  const { page, assigneeId: instanceAssigneeId } = await loadScheduleRow(ctx, input.id);
  const assigneeId = assignee === undefined ? undefined : assignee === null ? null : await resolveAssignee(ctx, assignee);
  await assertReferences(ctx, input);
  await requireCollabEpoch(ctx);

  const cells = await currentCells(ctx, page);
  if (instanceAssigneeId && !assigneeIdsOf(cells[COL.assignees]).includes(instanceAssigneeId)) {
    throw new ToolError("This card's assignee is no longer on the schedule; list_schedules again for current ids");
  }
  const { title, patch, nextInstanceAssigneeId } = buildUpdateCells(cells, instanceAssigneeId, {
    ...fields,
    attendance: fields.attendance === undefined ? undefined : normalizeLCSchedulerAttendanceValue(fields.attendance),
    ...(assigneeId !== undefined ? { assigneeId } : {}),
  }, Date.now());

  // 셀 권위(DB 룸)를 먼저 갱신해야 열린 뷰의 materialize 가 옛 셀로 Pages.dbCells 를 되돌리지 않는다(update_page 와 같은 순서).
  const cellsWrittenTo = await writeDbRowCells(ctx, LC_SCHEDULER_DATABASE_ID, String(page.id), patch);
  const { page: saved } = await patchPage(ctx, String(page.id), (latest) => ({
    ...(title !== undefined ? { title } : {}),
    dbCells: JSON.stringify(mergeCells(parseCells(latest.dbCells), patch)),
  }));
  const cards = await withNames(ctx, scheduleCardsOf(saved));
  const focusId = `${page.id}::${nextInstanceAssigneeId ?? "__global__"}`;
  return { updated: cards.find((c) => c.id === focusId) ?? null, cards, cellsWrittenTo };
}

// ---------- delete_schedule ----------

export async function deleteScheduleTool(ctx: McpContext, raw: z.input<typeof deleteScheduleInput>) {
  const input = deleteScheduleInput.parse(raw);
  await requireSchedulerWrite(ctx);
  const { page } = await loadScheduleRow(ctx, input.id);
  await requireCollabEpoch(ctx);
  const deleted = await softDeletePage({
    doc: ctx.doc,
    tables: ctx.tables,
    caller: ctx.caller,
    id: String(page.id),
    workspaceId: LC_SCHEDULER_WORKSPACE_ID,
    updatedAt: nowIso(),
    title: String(page.title ?? ""),
    icon: (page.icon as string | null | undefined) ?? null,
    databaseId: LC_SCHEDULER_DATABASE_ID,
  });
  await publishPage(deleted, { deletedAt: String(deleted.deletedAt ?? nowIso()) });
  invalidateWorkspaceMetas(ctx.doc, ctx.tables.Pages, LC_SCHEDULER_WORKSPACE_ID);
  // 앱 deleteRow 와 같이 DB 룸 rows·rowMembers·rowPageOrder 에서도 뺀다(유령 행 방지).
  const rowRemovedFrom = await removeDbRow(ctx, LC_SCHEDULER_DATABASE_ID, String(page.id));
  return { trashed: String(page.id), rowRemovedFrom, restorable: true, note: "Moved to trash; restore from QuickNote trash within 30 days" };
}

