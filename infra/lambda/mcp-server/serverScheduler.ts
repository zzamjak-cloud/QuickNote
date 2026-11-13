// 스케줄러 툴 등록 — 일정(작업 DB 행)·프로젝트·공휴일·주간 MM.
// 읽기는 토큰 범위·MCP 정책으로 스케줄러 WS 접근을 확인하고, 쓰기는 범용 쓰기 툴과 같은 관문
// (write scope·일일 쓰기 상한·감사 로그 runTool)을 거친다. 마일스톤·피처 행은 범용 create_pages·update_page·trash_page 로 쓴다.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "./context";
import { runTool } from "./toolRunner";
import { beginWrite } from "./writeAccess";
import {
  listMmEntriesInputShape,
  listMmEntriesTool,
  reviewMmEntryInputShape,
  reviewMmEntryTool,
  setMmEntryLockInputShape,
  setMmEntryLockTool,
  upsertMmEntryInputShape,
  upsertMmEntryTool,
} from "./tools/scheduler/mmEntries";
import {
  createHolidayInputShape,
  createHolidayTool,
  createProjectInputShape,
  createSchedulerProjectTool,
  deleteHolidayInputShape,
  deleteHolidayTool,
  deleteProjectInputShape,
  deleteSchedulerProjectTool,
  listHolidaysInputShape,
  listHolidaysTool,
  listProjectsInputShape,
  listSchedulerProjectsTool,
  updateHolidayInputShape,
  updateHolidayTool,
  updateProjectInputShape,
  updateSchedulerProjectTool,
} from "./tools/scheduler/projectsHolidays";
import {
  createScheduleInputShape,
  createScheduleTool,
  deleteScheduleInputShape,
  deleteScheduleTool,
  listSchedulesInputShape,
  listSchedulesTool,
  updateScheduleInputShape,
  updateScheduleTool,
} from "./tools/scheduler/schedules";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const DESTRUCTIVE = { ...WRITE, destructiveHint: true } as const;

const SCHEDULER_NOTE = "Scheduler (스케줄러) workspace; the token must include it.";
const WRITE_NOTE = `${SCHEDULER_NOTE} Requires a token with write scope.`;

/** write scope·일일 쓰기 상한을 통과한 뒤에만 실행(serverWrite.gated 와 같은 관문). */
function gated<T>(ctx: McpContext, fn: () => Promise<T>, units = 1): () => Promise<T> {
  return async () => {
    await beginWrite(ctx, units);
    return fn();
  };
}

export function registerSchedulerTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "list_schedules",
    {
      description:
        "List scheduler cards overlapping a date range (Korea time). Each card is one assignee's instance of a task row; " +
        `id = "<pageId>::<assigneeId>" ("::__global__" for team-wide events). Filters: assignee, project, organization, team, kind. ${SCHEDULER_NOTE}`,
      inputSchema: listSchedulesInputShape,
      annotations: READ_ONLY,
    },
    async (args) => runTool(ctx, "list_schedules", { from: args.from, to: args.to ?? null }, () => listSchedulesTool(ctx, args)),
  );

  server.registerTool(
    "create_schedule",
    {
      description:
        "Create a scheduler card the same way the app does: task preset (status todo, blue) or attendance preset for 근태/연차/attendance, " +
        "period stored as Korea-time day bounds, status auto-set from today unless given, no-assignee events colored orange. " +
        `Appears live in open schedulers. ${WRITE_NOTE}`,
      inputSchema: createScheduleInputShape,
      annotations: WRITE,
    },
    async (args) =>
      runTool(ctx, "create_schedule", { startDate: args.startDate }, gated(ctx, () => createScheduleTool(ctx, args)),
        (r) => ({ pageIds: [r.created[0]?.pageId] })),
  );

  server.registerTool(
    "update_schedule",
    {
      description:
        "Update a scheduler card by id: title, dates (status re-derived from today unless hold/attendance or status given), " +
        "assignee (replaces only this card's assignee), project/organization/team, attendance, color (row or card scope), lane, milestone/feature. " +
        WRITE_NOTE,
      inputSchema: updateScheduleInputShape,
      annotations: DESTRUCTIVE,
    },
    async (args) => runTool(ctx, "update_schedule", { scheduleId: args.id }, gated(ctx, () => updateScheduleTool(ctx, args))),
  );

  server.registerTool(
    "delete_schedule",
    {
      description: `Move a scheduler task row (all of its assignees' cards) to the trash (restorable for 30 days). To drop one assignee use update_schedule. ${WRITE_NOTE}`,
      inputSchema: deleteScheduleInputShape,
      annotations: DESTRUCTIVE,
    },
    async (args) =>
      runTool(ctx, "delete_schedule", { scheduleId: args.id }, gated(ctx, () => deleteScheduleTool(ctx, args)), (r) => ({ trashedIds: [r.trashed] })),
  );

  server.registerTool(
    "list_scheduler_projects",
    { description: `List scheduler projects (id, name, color, members, leaders, hidden). ${SCHEDULER_NOTE}`, inputSchema: listProjectsInputShape, annotations: READ_ONLY },
    async (args) => runTool(ctx, "list_scheduler_projects", {}, () => listSchedulerProjectsTool(ctx, args)),
  );

  server.registerTool(
    "create_scheduler_project",
    { description: `Create a scheduler project. members/leaders accept member ids or emails. ${WRITE_NOTE}`, inputSchema: createProjectInputShape, annotations: WRITE },
    async (args) =>
      runTool(ctx, "create_scheduler_project", {}, gated(ctx, () => createSchedulerProjectTool(ctx, args)), (r) => ({ projectId: r.id })),
  );

  server.registerTool(
    "update_scheduler_project",
    { description: `Update a scheduler project (name, color, description, members, leaders, hidden). ${WRITE_NOTE}`, inputSchema: updateProjectInputShape, annotations: WRITE },
    async (args) => runTool(ctx, "update_scheduler_project", { projectId: args.id }, gated(ctx, () => updateSchedulerProjectTool(ctx, args))),
  );

  server.registerTool(
    "delete_scheduler_project",
    { description: `Permanently delete a scheduler project (confirm: true required). ${WRITE_NOTE}`, inputSchema: deleteProjectInputShape, annotations: DESTRUCTIVE },
    async (args) => runTool(ctx, "delete_scheduler_project", { projectId: args.id }, gated(ctx, () => deleteSchedulerProjectTool(ctx, args))),
  );

  server.registerTool(
    "list_holidays",
    { description: `List holidays/events registered in the scheduler (types: holiday, evaluation, release, meeting, custom). ${SCHEDULER_NOTE}`, inputSchema: listHolidaysInputShape, annotations: READ_ONLY },
    async (args) => runTool(ctx, "list_holidays", { year: args.year ?? null }, () => listHolidaysTool(ctx, args)),
  );

  server.registerTool(
    "create_holiday",
    { description: `Register a scheduler holiday/event day. ${WRITE_NOTE}`, inputSchema: createHolidayInputShape, annotations: WRITE },
    async (args) => runTool(ctx, "create_holiday", { date: args.date }, gated(ctx, () => createHolidayTool(ctx, args)), (r) => ({ holidayId: r.id })),
  );

  server.registerTool(
    "update_holiday",
    { description: `Update a scheduler holiday/event day. ${WRITE_NOTE}`, inputSchema: updateHolidayInputShape, annotations: WRITE },
    async (args) => runTool(ctx, "update_holiday", { holidayId: args.id }, gated(ctx, () => updateHolidayTool(ctx, args))),
  );

  server.registerTool(
    "delete_holiday",
    { description: `Permanently delete a scheduler holiday/event day (confirm: true required). ${WRITE_NOTE}`, inputSchema: deleteHolidayInputShape, annotations: DESTRUCTIVE },
    async (args) => runTool(ctx, "delete_holiday", { holidayId: args.id }, gated(ctx, () => deleteHolidayTool(ctx, args))),
  );

  server.registerTool(
    "list_mm_entries",
    {
      description: `List weekly man-month (MM) entries between two Monday week starts, optionally for one member and with revision history. ${SCHEDULER_NOTE}`,
      inputSchema: listMmEntriesInputShape,
      annotations: READ_ONLY,
    },
    async (args) => runTool(ctx, "list_mm_entries", { from: args.fromWeekStart, to: args.toWeekStart ?? null }, () => listMmEntriesTool(ctx, args)),
  );

  server.registerTool(
    "upsert_mm_entry",
    {
      description:
        "Submit a weekly MM entry (Mon-Fri) as buckets whose ratioBp sum to 10000. Only your own entry unless your role is admin " +
        `(developer/owner/leader/manager); locked entries are rejected. ${WRITE_NOTE}`,
      inputSchema: upsertMmEntryInputShape,
      annotations: WRITE,
    },
    async (args) => runTool(ctx, "upsert_mm_entry", { weekStart: args.weekStart, member: args.member ?? null }, gated(ctx, () => upsertMmEntryTool(ctx, args)), (r) => ({ entryId: r.id })),
  );

  server.registerTool(
    "review_mm_entry",
    { description: `Mark an MM entry reviewed, optionally correcting its buckets (admin roles only). ${WRITE_NOTE}`, inputSchema: reviewMmEntryInputShape, annotations: WRITE },
    async (args) => runTool(ctx, "review_mm_entry", { entryId: args.entryId }, gated(ctx, () => reviewMmEntryTool(ctx, args))),
  );

  server.registerTool(
    "set_mm_entry_lock",
    { description: `Lock or unlock an MM entry (admin roles only). ${WRITE_NOTE}`, inputSchema: setMmEntryLockInputShape, annotations: WRITE },
    async (args) => runTool(ctx, "set_mm_entry_lock", { entryId: args.entryId, locked: args.locked }, gated(ctx, () => setMmEntryLockTool(ctx, args))),
  );
}
