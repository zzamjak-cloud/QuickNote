// 스케줄러 프로젝트·공휴일 툴 — v5 project.ts·holiday.ts 핸들러를 그대로 호출해 권한 규칙(스케줄러 WS edit)을 유지한다.
// 핸들러의 update 는 조건 없는 UpdateItem 이라 없는 id 면 부분 레코드를 새로 만든다 → 존재를 먼저 확인한다.
// 삭제는 하드 삭제(휴지통 없음)라 confirm: true 를 요구한다.
import { z } from "zod";
import { DEFAULT_SCHEDULE_COLOR } from "../../../../../src/lib/scheduler/colors";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../../v5-resolvers/handlers/_auth";
import { createHoliday, deleteHoliday, listHolidays, updateHoliday } from "../../../v5-resolvers/handlers/holiday";
import { createProject, deleteProject, listProjects, updateProject } from "../../../v5-resolvers/handlers/project";
import { requireWorkspace } from "../../access";
import { resolveWorkspaceMember } from "../../cellInput";
import { ToolError, type McpContext } from "../../context";
import { getItem } from "../../ddb";
import { requireSchedulerWrite } from "../../writeAccess";
import { assertYmd } from "./scheduleCells";

const WS = LC_SCHEDULER_WORKSPACE_ID;
const idString = z.string().trim().min(1).max(256);
const hex = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "expected #RRGGBB");
const memberRefs = z.array(z.string().trim().min(1).max(320)).max(200);
const confirm = z.literal(true).describe("Must be true: deletion is permanent (no trash)");
const HOLIDAY_TYPES = ["holiday", "evaluation", "release", "meeting", "custom"] as const;
/** 프로젝트 관리 화면의 새 프로젝트 기본 색(ProjectsPanel). */
const DEFAULT_PROJECT_COLOR = "#3b82f6";

function base(ctx: McpContext) {
  return { doc: ctx.doc, tables: ctx.tables, caller: ctx.caller };
}

async function memberIds(ctx: McpContext, refs: string[] | undefined): Promise<string[] | undefined> {
  if (!refs) return undefined;
  const ids: string[] = [];
  for (const ref of refs) {
    const id = await resolveWorkspaceMember(ctx, ref, WS);
    if (!id) throw new ToolError(`Unknown or inactive member "${ref}" (use get_users for ids/emails)`);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

async function requireExisting(ctx: McpContext, table: string, id: string, label: string): Promise<void> {
  if (!(await getItem(ctx.doc, table, { id, workspaceId: WS }))) throw new ToolError(`Unknown ${label} "${id}"`);
}

// ---------- 프로젝트 ----------

export const listProjectsInputShape = {
  includeHidden: z.boolean().optional().describe("Include hidden projects (default true)"),
};
export async function listSchedulerProjectsTool(ctx: McpContext, raw: { includeHidden?: boolean }) {
  const input = z.object(listProjectsInputShape).parse(raw);
  await requireWorkspace(ctx, WS);
  const projects = await listProjects({ ...base(ctx), workspaceId: WS });
  const visible = input.includeHidden === false ? projects.filter((p) => !p.isHidden) : projects;
  return { projects: visible.sort((a, b) => a.name.localeCompare(b.name)) };
}

const projectFields = {
  name: z.string().trim().min(1).max(200).optional(),
  color: hex.optional(),
  description: z.string().max(2000).optional(),
  members: memberRefs.optional().describe("Member ids or emails (replaces the list)"),
  leaders: memberRefs.optional().describe("Leader member ids or emails (must also be members)"),
  isHidden: z.boolean().optional(),
};

export const createProjectInputShape = { ...projectFields, name: z.string().trim().min(1).max(200) };
export async function createSchedulerProjectTool(ctx: McpContext, raw: z.input<z.ZodObject<typeof createProjectInputShape>>) {
  const input = z.object(createProjectInputShape).strict().parse(raw);
  await requireSchedulerWrite(ctx);
  const members = (await memberIds(ctx, input.members)) ?? [];
  const leaders = ((await memberIds(ctx, input.leaders)) ?? []).filter((id) => members.includes(id));
  return createProject({
    ...base(ctx),
    input: {
      workspaceId: WS,
      name: input.name,
      color: input.color ?? DEFAULT_PROJECT_COLOR,
      description: input.description?.trim() || null,
      memberIds: members,
      leaderMemberIds: leaders,
      isHidden: input.isHidden ?? false,
    },
  });
}

export const updateProjectInputShape = { id: idString, ...projectFields };
export async function updateSchedulerProjectTool(ctx: McpContext, raw: z.input<z.ZodObject<typeof updateProjectInputShape>>) {
  const input = z.object(updateProjectInputShape).strict().parse(raw);
  const { id, members: memberRefList, leaders: leaderRefList, ...rest } = input;
  if (Object.values(rest).every((v) => v === undefined) && !memberRefList && !leaderRefList) throw new ToolError("Nothing to update");
  await requireSchedulerWrite(ctx);
  await requireExisting(ctx, ctx.tables.Projects, id, "scheduler project");
  const members = await memberIds(ctx, memberRefList);
  const leaders = await memberIds(ctx, leaderRefList);
  return updateProject({
    ...base(ctx),
    input: { id, workspaceId: WS, ...rest, memberIds: members ?? null, leaderMemberIds: leaders ?? null },
  });
}

export const deleteProjectInputShape = { id: idString, confirm };
export async function deleteSchedulerProjectTool(ctx: McpContext, raw: { id: string; confirm: true }) {
  const input = z.object(deleteProjectInputShape).strict().parse(raw);
  await requireSchedulerWrite(ctx);
  await requireExisting(ctx, ctx.tables.Projects, input.id, "scheduler project");
  await deleteProject({ ...base(ctx), id: input.id, workspaceId: WS });
  return { deleted: input.id };
}

// ---------- 공휴일 ----------

export const listHolidaysInputShape = {
  year: z.number().int().min(2000).max(2100).optional().describe("Only this year"),
};
export async function listHolidaysTool(ctx: McpContext, raw: { year?: number }) {
  const input = z.object(listHolidaysInputShape).parse(raw);
  await requireWorkspace(ctx, WS);
  const holidays = await listHolidays({ ...base(ctx), workspaceId: WS });
  const filtered = input.year ? holidays.filter((h) => h.date.startsWith(`${input.year}-`)) : holidays;
  return {
    holidays: filtered.sort((a, b) => a.date.localeCompare(b.date)),
    note: "Only holidays registered in QuickNote; official Korean public holidays are built into the app and not listed",
  };
}

const holidayFields = {
  title: z.string().trim().min(1).max(200).optional(),
  date: z.string().trim().optional().describe("YYYY-MM-DD"),
  type: z.enum(HOLIDAY_TYPES).optional(),
  color: hex.optional(),
};

export const createHolidayInputShape = {
  ...holidayFields,
  title: z.string().trim().min(1).max(200),
  date: z.string().trim().describe("YYYY-MM-DD"),
};
export async function createHolidayTool(ctx: McpContext, raw: z.input<z.ZodObject<typeof createHolidayInputShape>>) {
  const input = z.object(createHolidayInputShape).strict().parse(raw);
  assertYmd(input.date, "date");
  await requireSchedulerWrite(ctx);
  return createHoliday({
    ...base(ctx),
    input: { workspaceId: WS, title: input.title, date: input.date, type: input.type ?? "holiday", color: input.color ?? DEFAULT_SCHEDULE_COLOR },
  });
}

export const updateHolidayInputShape = { id: idString, ...holidayFields };
export async function updateHolidayTool(ctx: McpContext, raw: z.input<z.ZodObject<typeof updateHolidayInputShape>>) {
  const input = z.object(updateHolidayInputShape).strict().parse(raw);
  const { id, ...rest } = input;
  if (Object.values(rest).every((v) => v === undefined)) throw new ToolError("Nothing to update");
  if (rest.date) assertYmd(rest.date, "date");
  await requireSchedulerWrite(ctx);
  await requireExisting(ctx, ctx.tables.Holidays, id, "holiday");
  return updateHoliday({ ...base(ctx), input: { id, workspaceId: WS, ...rest } });
}

export const deleteHolidayInputShape = { id: idString, confirm };
export async function deleteHolidayTool(ctx: McpContext, raw: { id: string; confirm: true }) {
  const input = z.object(deleteHolidayInputShape).strict().parse(raw);
  await requireSchedulerWrite(ctx);
  await requireExisting(ctx, ctx.tables.Holidays, input.id, "holiday");
  await deleteHoliday({ ...base(ctx), id: input.id, workspaceId: WS });
  return { deleted: input.id };
}
