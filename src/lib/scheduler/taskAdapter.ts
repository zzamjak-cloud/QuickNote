import { useDatabaseStore } from "../../store/databaseStore";
import { useMemberStore } from "../../store/memberStore";
import { usePageStore } from "../../store/pageStore";
import type { CreateScheduleInput, Schedule, UpdateScheduleInput } from "../../store/schedulerStore";
import type { CellValue, DateRangeValue } from "../../types/database";
import type { Page } from "../../types/page";
import { ANNUAL_LEAVE_COLOR, DEFAULT_SCHEDULE_COLOR, pickTextColor } from "./colors";
import {
  LC_SCHEDULER_ATTENDANCE_TITLE,
  LC_SCHEDULER_ATTENDANCE_PRESET_ID,
  LC_SCHEDULER_COLUMN_IDS,
  LC_SCHEDULER_TASK_PRESET_ID,
  makeLCSchedulerDatabaseId,
  ensureLCSchedulerDatabase,
  getLCSchedulerAttendanceLabel,
  normalizeLCSchedulerAttendanceValue,
} from "./database";
import { resolveLCSchedulerWorkspaceId } from "./scope";
import { readRememberedSchedulerPropertyValues } from "./lastPropertyMemory";
import {
  getSchedulerTaskRowIndex,
  parseSchedulerTaskMeta,
  setSchedulerTaskRowIndex,
  type SchedulerTaskMeta,
} from "./taskMeta";
import { isDeletedSchedulePage, markDeletedSchedulePage } from "./deletedSchedulePages";

const INSTANCE_SEPARATOR = "::";
const GLOBAL_ASSIGNEE_ID = "__global__";

type MemberLike = {
  memberId: string;
  name: string;
};

export function makeScheduleInstanceId(pageId: string, assigneeId: string | null): string {
  return `${pageId}${INSTANCE_SEPARATOR}${assigneeId ?? GLOBAL_ASSIGNEE_ID}`;
}

export function parseScheduleInstanceId(id: string): { pageId: string; assigneeId: string | null } | null {
  const idx = id.lastIndexOf(INSTANCE_SEPARATOR);
  if (idx <= 0) return null;
  const pageId = id.slice(0, idx);
  const assigneeId = id.slice(idx + INSTANCE_SEPARATOR.length);
  return { pageId, assigneeId: assigneeId === GLOBAL_ASSIGNEE_ID ? null : assigneeId };
}

function asDateRange(value: CellValue): DateRangeValue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const range = value as DateRangeValue;
  if (typeof range.start !== "string") return null;
  return {
    start: range.start,
    end: typeof range.end === "string" ? range.end : range.start,
  };
}

function asString(value: CellValue): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metaWithSchedulerKind(
  meta: SchedulerTaskMeta,
  status: string | null,
  attendanceValue: string | null,
): SchedulerTaskMeta {
  const normalizedAttendanceValue = normalizeLCSchedulerAttendanceValue(attendanceValue);
  if (normalizedAttendanceValue) {
    return {
      ...meta,
      kind: "leave",
      annualLeave: normalizedAttendanceValue === "annual-leave",
      attendanceValue: normalizedAttendanceValue,
    };
  }
  if (status === "leave") return { ...meta, kind: "leave", attendanceValue: "annual-leave" };
  if (meta.kind === "leave" || meta.attendanceValue) {
    const { annualLeave: _annualLeave, attendanceValue: _attendanceValue, ...rest } = meta;
    return { ...rest, kind: "schedule" };
  }
  return meta;
}

function normalizeAssignees(value: CellValue, members: MemberLike[]): string[] {
  const raw: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) raw.push(item.trim());
    }
  } else if (typeof value === "string") {
    raw.push(...value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean));
  }
  if (!raw.length) return [];
  if (!members.length) return Array.from(new Set(raw));
  const byName = new Map(members.map((member) => [member.name, member.memberId]));
  const byId = new Set(members.map((member) => member.memberId));
  const out: string[] = [];
  for (const item of raw) {
    const memberId = byId.has(item) ? item : byName.get(item);
    if (memberId && !out.includes(memberId)) out.push(memberId);
  }
  return out;
}

function scheduleFromPage(args: {
  page: Page;
  workspaceId: string;
  assigneeId: string | null;
  meta: SchedulerTaskMeta;
  range: DateRangeValue;
  color: string | null;
  projectId: string | null;
  teamId: string | null;
  organizationId: string | null;
  attendanceValue: string | null;
}): Schedule {
  const attendanceValue = normalizeLCSchedulerAttendanceValue(args.attendanceValue);
  const isAttendance = attendanceValue !== null;
  const attendanceLabel = getLCSchedulerAttendanceLabel(attendanceValue);
  const rawMeta = parseSchedulerTaskMeta(args.page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.meta]);
  const isAutoAttendanceColor =
    !isAttendance &&
    (args.page.title === LC_SCHEDULER_ATTENDANCE_TITLE || rawMeta.kind === "leave" || rawMeta.attendanceValue) &&
    typeof args.color === "string" &&
    ["#e74c3c", "#e64c4c"].includes(args.color.toLowerCase());
  const color = isAttendance
    ? ANNUAL_LEAVE_COLOR
    : isAutoAttendanceColor
      ? DEFAULT_SCHEDULE_COLOR
      : args.color ?? DEFAULT_SCHEDULE_COLOR;
  return {
    id: makeScheduleInstanceId(args.page.id, args.assigneeId),
    workspaceId: args.workspaceId,
    title: attendanceLabel ?? args.page.title,
    comment: null,
    link: null,
    kind: isAttendance ? "leave" : "schedule",
    projectId: args.projectId,
    teamId: args.teamId,
    organizationId: args.organizationId,
    startAt: args.range.start ?? new Date(args.page.createdAt).toISOString(),
    endAt: args.range.end ?? args.range.start ?? new Date(args.page.createdAt).toISOString(),
    assigneeId: args.assigneeId,
    color,
    textColor: args.meta.textColor ?? pickTextColor(color),
    rowIndex: getSchedulerTaskRowIndex(args.meta, args.assigneeId),
    createdByMemberId: args.page.createdByMemberId ?? "",
    createdAt: new Date(args.page.createdAt).toISOString(),
    updatedAt: new Date(args.page.updatedAt).toISOString(),
  };
}

export function projectLCSchedulerSchedules(
  workspaceId: string,
  members: MemberLike[],
): Schedule[] {
  const schedulerWorkspaceId = resolveLCSchedulerWorkspaceId(workspaceId);
  const databaseId = makeLCSchedulerDatabaseId(schedulerWorkspaceId);
  const pages = usePageStore.getState().pages;
  const rows = Object.values(pages)
    .filter((page) => page.databaseId === databaseId)
    .filter((page) => !isDeletedSchedulePage(page.id))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const schedules: Schedule[] = [];
  for (const page of rows) {
    if (page.dbCells?.["_qn_isTemplate"] === "1") continue;
    const range = asDateRange(page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.period]);
    if (!range) continue;
    const status = asString(page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.status]);
    const attendanceValue = asString(page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.attendance])
      ?? (status === "leave" ? "annual-leave" : null);
    const meta = metaWithSchedulerKind(
      parseSchedulerTaskMeta(page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.meta]),
      status,
      attendanceValue,
    );
    const color = asString(page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.color]);
    const projectId = asString(page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.project]);
    const teamId = asString(page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.team]);
    const organizationId = asString(page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.organization]);
    const assigneeIds = normalizeAssignees(
      page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.assignees],
      members,
    );
    if (!assigneeIds.length) {
      schedules.push(scheduleFromPage({ page, workspaceId, assigneeId: null, meta, range, color, projectId, teamId, organizationId, attendanceValue }));
      continue;
    }
    for (const assigneeId of assigneeIds) {
      schedules.push(scheduleFromPage({ page, workspaceId, assigneeId, meta, range, color, projectId, teamId, organizationId, attendanceValue }));
    }
  }
  return schedules;
}

export function projectLCSchedulerPageSchedules(
  workspaceId: string,
  pageId: string,
  members: MemberLike[],
): Schedule[] {
  const schedulerWorkspaceId = resolveLCSchedulerWorkspaceId(workspaceId);
  const databaseId = makeLCSchedulerDatabaseId(schedulerWorkspaceId);
  const page = usePageStore.getState().pages[pageId];
  if (!page || page.databaseId !== databaseId) return [];
  if (isDeletedSchedulePage(page.id)) return [];
  if (page.dbCells?.["_qn_isTemplate"] === "1") return [];
  const range = asDateRange(page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.period]);
  if (!range) return [];
  const status = asString(page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.status]);
  const attendanceValue = asString(page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.attendance])
    ?? (status === "leave" ? "annual-leave" : null);
  const meta = metaWithSchedulerKind(
    parseSchedulerTaskMeta(page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.meta]),
    status,
    attendanceValue,
  );
  const color = asString(page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.color]);
  const projectId = asString(page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.project]);
  const teamId = asString(page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.team]);
  const organizationId = asString(page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.organization]);
  const assigneeIds = normalizeAssignees(
    page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.assignees],
    members,
  );
  if (!assigneeIds.length) {
    return [
      scheduleFromPage({ page, workspaceId, assigneeId: null, meta, range, color, projectId, teamId, organizationId, attendanceValue }),
    ];
  }
  return assigneeIds.map((assigneeId) =>
    scheduleFromPage({ page, workspaceId, assigneeId, meta, range, color, projectId, teamId, organizationId, attendanceValue }),
  );
}

function setCell(databaseId: string, pageId: string, columnId: string, value: CellValue): void {
  useDatabaseStore.getState().updateCell(databaseId, pageId, columnId, value);
}

function replaceAssignee(
  current: string[],
  from: string | null,
  to: string | null | undefined,
): string[] {
  if (to === undefined) return current;
  if (to === null) return [];
  const next = current.filter((item) => item !== from);
  if (!next.includes(to)) next.push(to);
  return next;
}

function applySpecialScopeDefaults(
  databaseId: string,
  pageId: string,
  selectedScopeKey: string | null | undefined,
): void {
  if (!selectedScopeKey) return;
  const nextOrg = selectedScopeKey.startsWith("org:") ? selectedScopeKey.slice(4) : null;
  const nextTeam = selectedScopeKey.startsWith("team:") ? selectedScopeKey.slice(5) : null;
  const nextProject = selectedScopeKey.startsWith("proj:") ? selectedScopeKey.slice(5) : null;

  setCell(databaseId, pageId, LC_SCHEDULER_COLUMN_IDS.assignees, []);
  setCell(databaseId, pageId, LC_SCHEDULER_COLUMN_IDS.organization, nextOrg);
  setCell(databaseId, pageId, LC_SCHEDULER_COLUMN_IDS.team, nextTeam);
  setCell(databaseId, pageId, LC_SCHEDULER_COLUMN_IDS.project, nextProject);
}

function resolveCreateColor(input: CreateScheduleInput): string | null {
  const isSpecial = (input.assigneeId ?? null) === null;
  if (isSpecial) return "#f59e0b";
  return input.color ?? null;
}

function applyAttendanceCreateDefaults(databaseId: string, pageId: string): void {
  const applied = useDatabaseStore
    .getState()
    .applyPresetToRow(databaseId, pageId, LC_SCHEDULER_ATTENDANCE_PRESET_ID);
  if (applied) return;
  setCell(databaseId, pageId, LC_SCHEDULER_COLUMN_IDS.title, "연차");
  setCell(databaseId, pageId, LC_SCHEDULER_COLUMN_IDS.status, "todo");
  setCell(databaseId, pageId, LC_SCHEDULER_COLUMN_IDS.attendance, "annual-leave");
  setCell(databaseId, pageId, LC_SCHEDULER_COLUMN_IDS.color, ANNUAL_LEAVE_COLOR);
  setCell(databaseId, pageId, LC_SCHEDULER_COLUMN_IDS.meta, {
    kind: "leave",
    annualLeave: true,
    attendanceValue: "annual-leave",
  } as CellValue);
}

export async function createLCSchedulerSchedule(input: CreateScheduleInput): Promise<Schedule> {
  const schedulerWorkspaceId = resolveLCSchedulerWorkspaceId(input.workspaceId);
  await ensureLCSchedulerDatabase(schedulerWorkspaceId);
  const databaseId = makeLCSchedulerDatabaseId(schedulerWorkspaceId);
  const pageId = useDatabaseStore.getState().addRow(databaseId);
  const bundle = useDatabaseStore.getState().databases[databaseId];
  const isAttendanceCreate = input.title === LC_SCHEDULER_ATTENDANCE_TITLE || input.title === "연차";
  const presetId = isAttendanceCreate
    ? LC_SCHEDULER_ATTENDANCE_PRESET_ID
    : LC_SCHEDULER_TASK_PRESET_ID;
  if (bundle?.presets?.some((preset) => preset.id === presetId)) {
    useDatabaseStore.getState().applyPresetToRow(databaseId, pageId, presetId);
  }
  // 사용자가 마지막으로 적용한 속성값을 새 일정 생성 시 기본값으로 복원한다.
  const remembered = readRememberedSchedulerPropertyValues(schedulerWorkspaceId);
  for (const [columnId, value] of Object.entries(remembered)) {
    setCell(databaseId, pageId, columnId, value);
  }
  if (isAttendanceCreate) {
    applyAttendanceCreateDefaults(databaseId, pageId);
  }
  applySpecialScopeDefaults(databaseId, pageId, input.selectedScopeKey);
  const color = resolveCreateColor(input);
  return updateLCSchedulerSchedule({
    id: makeScheduleInstanceId(pageId, input.assigneeId ?? null),
    workspaceId: input.workspaceId,
    title: isAttendanceCreate ? "연차" : input.title,
    projectId: input.projectId ?? null,
    startAt: input.startAt,
    endAt: input.endAt,
    assigneeId: input.assigneeId ?? null,
    color,
    textColor: input.textColor ?? (color ? pickTextColor(color) : null),
    rowIndex: input.rowIndex ?? 0,
  });
}

export async function updateLCSchedulerSchedule(input: UpdateScheduleInput): Promise<Schedule> {
  const schedulerWorkspaceId = resolveLCSchedulerWorkspaceId(input.workspaceId);
  const parsed = parseScheduleInstanceId(input.id);
  if (!parsed) throw new Error("LC스케줄러 카드 ID가 올바르지 않습니다");
  const databaseId = makeLCSchedulerDatabaseId(schedulerWorkspaceId);
  const page = usePageStore.getState().pages[parsed.pageId];
  if (!page || page.databaseId !== databaseId) {
    throw new Error("LC스케줄러 행 페이지를 찾을 수 없습니다");
  }

  if (input.title !== undefined && input.title !== null) {
    setCell(databaseId, page.id, LC_SCHEDULER_COLUMN_IDS.title, input.title);
  }
  if (input.startAt || input.endAt) {
    const prev = asDateRange(page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.period]);
    setCell(databaseId, page.id, LC_SCHEDULER_COLUMN_IDS.period, {
      start: input.startAt ?? prev?.start,
      end: input.endAt ?? prev?.end ?? input.startAt ?? prev?.start,
    });
  }
  if (input.projectId !== undefined) {
    setCell(databaseId, page.id, LC_SCHEDULER_COLUMN_IDS.project, input.projectId);
  }
  if (input.assigneeId !== undefined) {
    const current = normalizeAssignees(
      page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.assignees],
      [],
    );
    setCell(
      databaseId,
      page.id,
      LC_SCHEDULER_COLUMN_IDS.assignees,
      replaceAssignee(current, parsed.assigneeId, input.assigneeId),
    );
  }
  if (input.color !== undefined) {
    setCell(databaseId, page.id, LC_SCHEDULER_COLUMN_IDS.color, input.color);
  }

  const latest = usePageStore.getState().pages[page.id] ?? page;
  const meta = parseSchedulerTaskMeta(latest.dbCells?.[LC_SCHEDULER_COLUMN_IDS.meta]);
  const nextMeta = setSchedulerTaskRowIndex(
    {
      ...meta,
      textColor: input.textColor !== undefined ? input.textColor : meta.textColor,
    },
    input.assigneeId ?? parsed.assigneeId,
    input.rowIndex,
  );
  setCell(databaseId, page.id, LC_SCHEDULER_COLUMN_IDS.meta, nextMeta as CellValue);

  const projected = projectLCSchedulerPageSchedules(input.workspaceId, page.id, useMemberStore.getState().members);
  const schedule = projected.find((item) => item.id === (
    input.assigneeId !== undefined
      ? makeScheduleInstanceId(page.id, input.assigneeId)
      : input.id
  ));
  if (!schedule) throw new Error("LC스케줄러 카드 투영에 실패했습니다");
  return schedule;
}

export async function deleteLCSchedulerSchedule(id: string, workspaceId: string): Promise<void> {
  const schedulerWorkspaceId = resolveLCSchedulerWorkspaceId(workspaceId);
  const parsed = parseScheduleInstanceId(id);
  if (!parsed) throw new Error("LC스케줄러 카드 ID가 올바르지 않습니다");
  const databaseId = makeLCSchedulerDatabaseId(schedulerWorkspaceId);
  markDeletedSchedulePage(parsed.pageId);
  useDatabaseStore.getState().deleteRow(databaseId, parsed.pageId);
}
