// 주간 MM 툴 — v5 mm.ts 핸들러를 직접 호출해 권한 규칙을 그대로 유지한다:
// 본인 MM 만 입력(관리자 역할 developer·owner·leader·manager 는 타인 가능), 리뷰·잠금은 관리자만, 잠금된 항목은 수정 불가.
import { z } from "zod";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../../v5-resolvers/handlers/_auth";
import { listMmEntries, listMmRevisions, reviewMmEntry, setMmEntryLock, upsertMmEntry } from "../../../v5-resolvers/handlers/mm";
import { requireWorkspace } from "../../access";
import { resolveWorkspaceMember } from "../../cellInput";
import { ToolError, type McpContext } from "../../context";
import { requireSchedulerWrite } from "../../writeAccess";
import { assertYmd, shiftYmd } from "./scheduleCells";

const WS = LC_SCHEDULER_WORKSPACE_ID;
const idString = z.string().trim().min(1).max(512);
/** 앱 MM 주간 = 월~금(weekUtils.getWeekEndKey = 시작 + 4일). */
const WEEK_END_OFFSET_DAYS = 4;

const reasonInput = z.object({
  date: z.string().trim().describe("YYYY-MM-DD"),
  type: z.enum(["holiday", "leave", "empty", "unclassified"]),
  label: z.string().max(200),
  ratioBp: z.number().int().min(0).max(10_000),
}).strict();

const bucketInput = z.object({
  id: z.string().trim().min(1).max(256).describe('Bucket id, e.g. "project:<projectId>" or "other"'),
  kind: z.enum(["organization", "team", "project", "other"]),
  scopeId: z.string().trim().max(256).nullable().optional().describe("Organization/team/project id for that kind"),
  label: z.string().trim().min(1).max(200),
  ratioBp: z.number().int().min(0).max(10_000).describe("Share in basis points (100% = 10000); all buckets must sum to 10000"),
  editable: z.boolean().optional(),
  reasons: z.array(reasonInput).max(20).optional().describe('Breakdown for the "other" bucket (holiday/leave/empty days)'),
}).strict();

function base(ctx: McpContext) {
  return { doc: ctx.doc, tables: ctx.tables, caller: ctx.caller };
}

/** MM 주 시작은 월요일 — 다른 요일로 저장하면 앱 주간 화면에 나타나지 않는다. */
function assertMonday(value: string, field: string): void {
  assertYmd(value, field);
  if (new Date(`${value}T00:00:00.000Z`).getUTCDay() !== 1) throw new ToolError(`${field} must be a Monday (MM weeks start on Monday)`);
}

async function memberIdOf(ctx: McpContext, ref: string | undefined): Promise<string> {
  if (!ref) return ctx.caller.memberId;
  const id = await resolveWorkspaceMember(ctx, ref, WS);
  if (!id) throw new ToolError(`Unknown or inactive member "${ref}" (use get_users for ids/emails)`);
  return id;
}

function toBuckets(buckets: z.infer<typeof bucketInput>[]) {
  // 앱 제안(mmSuggestion)과 같이 "기타" 버킷만 기본 편집 불가.
  return buckets.map((b) => ({ ...b, scopeId: b.scopeId ?? null, editable: b.editable ?? b.kind !== "other", reasons: b.reasons ?? [] }));
}

export const listMmEntriesInputShape = {
  fromWeekStart: z.string().trim().describe("First week (Monday, YYYY-MM-DD)"),
  toWeekStart: z.string().trim().optional().describe("Last week (Monday, default = fromWeekStart)"),
  member: z.string().trim().min(1).max(320).optional().describe("Only this member (id or email)"),
  includeRevisions: z.boolean().optional().describe("Also return the change history of each entry"),
};
export async function listMmEntriesTool(ctx: McpContext, raw: z.input<z.ZodObject<typeof listMmEntriesInputShape>>) {
  const input = z.object(listMmEntriesInputShape).strict().parse(raw);
  const to = input.toWeekStart ?? input.fromWeekStart;
  assertMonday(input.fromWeekStart, "fromWeekStart");
  assertMonday(to, "toWeekStart");
  if (to < input.fromWeekStart) throw new ToolError("toWeekStart must be on or after fromWeekStart");
  if (to > shiftYmd(input.fromWeekStart, 7 * 53)) throw new ToolError("Range is at most 53 weeks");
  await requireWorkspace(ctx, WS);
  const memberId = input.member ? await memberIdOf(ctx, input.member) : null;
  const entries = await listMmEntries({ ...base(ctx), workspaceId: WS, fromWeekStart: input.fromWeekStart, toWeekStart: to, memberId });
  if (!input.includeRevisions) return { entries };
  const withRevisions = [];
  for (const entry of entries) {
    withRevisions.push({ ...entry, revisions: await listMmRevisions({ ...base(ctx), workspaceId: WS, entryId: entry.id }) });
  }
  return { entries: withRevisions };
}

export const upsertMmEntryInputShape = {
  weekStart: z.string().trim().describe("Week start (Monday, YYYY-MM-DD)"),
  member: z.string().trim().min(1).max(320).optional().describe("Member id or email (default: the token owner). Others require an admin role"),
  buckets: z.array(bucketInput).min(1).max(50),
  organizationId: z.string().trim().max(256).nullable().optional(),
  teamId: z.string().trim().max(256).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
};
export async function upsertMmEntryTool(ctx: McpContext, raw: z.input<z.ZodObject<typeof upsertMmEntryInputShape>>) {
  const input = z.object(upsertMmEntryInputShape).strict().parse(raw);
  assertMonday(input.weekStart, "weekStart");
  await requireSchedulerWrite(ctx);
  const memberId = await memberIdOf(ctx, input.member);
  return upsertMmEntry({
    ...base(ctx),
    input: {
      workspaceId: WS,
      memberId,
      weekStart: input.weekStart,
      weekEnd: shiftYmd(input.weekStart, WEEK_END_OFFSET_DAYS),
      buckets: toBuckets(input.buckets),
      organizationId: input.organizationId ?? null,
      teamId: input.teamId ?? null,
      note: input.note ?? null,
    },
  });
}

export const reviewMmEntryInputShape = {
  entryId: idString.describe("Entry id from list_mm_entries"),
  buckets: z.array(bucketInput).min(1).max(50).optional().describe("Corrected buckets (default: keep submitted values)"),
  note: z.string().max(2000).nullable().optional(),
};
export async function reviewMmEntryTool(ctx: McpContext, raw: z.input<z.ZodObject<typeof reviewMmEntryInputShape>>) {
  const input = z.object(reviewMmEntryInputShape).strict().parse(raw);
  await requireSchedulerWrite(ctx);
  return reviewMmEntry({
    ...base(ctx),
    input: { workspaceId: WS, entryId: input.entryId, buckets: input.buckets ? toBuckets(input.buckets) : null, note: input.note ?? null },
  });
}

export const setMmEntryLockInputShape = {
  entryId: idString.describe("Entry id from list_mm_entries"),
  locked: z.boolean().describe("true = lock (no further edits), false = unlock"),
  note: z.string().max(2000).nullable().optional(),
};
export async function setMmEntryLockTool(ctx: McpContext, raw: z.input<z.ZodObject<typeof setMmEntryLockInputShape>>) {
  const input = z.object(setMmEntryLockInputShape).strict().parse(raw);
  await requireSchedulerWrite(ctx);
  return setMmEntryLock({ ...base(ctx), workspaceId: WS, entryId: input.entryId, locked: input.locked, note: input.note ?? null });
}
