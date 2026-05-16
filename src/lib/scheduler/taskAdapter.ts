import { useDatabaseStore } from "../../store/databaseStore";
import { useMemberStore } from "../../store/memberStore";
import { usePageStore } from "../../store/pageStore";
import type { CreateScheduleInput, Schedule, UpdateScheduleInput } from "../../store/schedulerStore";
import type { CellValue, DateRangeValue } from "../../types/database";
import type { Page } from "../../types/page";
import { pickTextColor } from "./colors";
import {
  LC_SCHEDULER_COLUMN_IDS,
  makeLCSchedulerDatabaseId,
  ensureLCSchedulerDatabase,
} from "./database";
import { readRememberedSchedulerPropertyValues } from "./lastPropertyMemory";
import {
  parseSchedulerTaskMeta,
  setSchedulerTaskRowIndex,
  type SchedulerTaskMeta,
} from "./taskMeta";

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
}): Schedule {
  const color = args.color ?? (args.meta.kind === "leave" ? "#E74C3C" : "#3498DB");
  return {
    id: makeScheduleInstanceId(args.page.id, args.assigneeId),
    workspaceId: args.workspaceId,
    title: args.page.title,
    comment: null,
    link: null,
    projectId: args.projectId,
    startAt: args.range.start ?? new Date(args.page.createdAt).toISOString(),
    endAt: args.range.end ?? args.range.start ?? new Date(args.page.createdAt).toISOString(),
    assigneeId: args.assigneeId,
    color,
    textColor: args.meta.textColor ?? pickTextColor(color),
    rowIndex: args.assigneeId
      ? args.meta.rowIndexByAssigneeId?.[args.assigneeId] ?? 0
      : 0,
    createdByMemberId: args.page.createdByMemberId ?? "",
    createdAt: new Date(args.page.createdAt).toISOString(),
    updatedAt: new Date(args.page.updatedAt).toISOString(),
  };
}

export function projectLCSchedulerSchedules(
  workspaceId: string,
  members: MemberLike[],
): Schedule[] {
  const databaseId = makeLCSchedulerDatabaseId(workspaceId);
  const pages = usePageStore.getState().pages;
  const rows = Object.values(pages)
    .filter((page) => page.databaseId === databaseId)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const schedules: Schedule[] = [];
  for (const page of rows) {
    if (page.dbCells?.["_qn_isTemplate"] === "1") continue;
    const range = asDateRange(page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.period]);
    if (!range) continue;
    const meta = parseSchedulerTaskMeta(page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.meta]);
    const color = asString(page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.color]);
    const projectId = asString(page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.project]);
    const assigneeIds = normalizeAssignees(
      page.dbCells?.[LC_SCHEDULER_COLUMN_IDS.assignees],
      members,
    );
    if (!assigneeIds.length) {
      schedules.push(scheduleFromPage({ page, workspaceId, assigneeId: null, meta, range, color, projectId }));
      continue;
    }
    for (const assigneeId of assigneeIds) {
      schedules.push(scheduleFromPage({ page, workspaceId, assigneeId, meta, range, color, projectId }));
    }
  }
  return schedules;
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

export async function createLCSchedulerSchedule(input: CreateScheduleInput): Promise<Schedule> {
  await ensureLCSchedulerDatabase(input.workspaceId);
  const databaseId = makeLCSchedulerDatabaseId(input.workspaceId);
  const pageId = useDatabaseStore.getState().addRow(databaseId);
  const bundle = useDatabaseStore.getState().databases[databaseId];
  const presetId = input.title === "연차"
    ? "lc-scheduler-preset:annual-leave"
    : "lc-scheduler-preset:task";
  if (bundle?.presets?.some((preset) => preset.id === presetId)) {
    useDatabaseStore.getState().applyPresetToRow(databaseId, pageId, presetId);
  }
  // 사용자가 마지막으로 적용한 속성값을 새 일정 생성 시 기본값으로 복원한다.
  const remembered = readRememberedSchedulerPropertyValues(input.workspaceId);
  for (const [columnId, value] of Object.entries(remembered)) {
    setCell(databaseId, pageId, columnId, value);
  }
  return updateLCSchedulerSchedule({
    id: makeScheduleInstanceId(pageId, input.assigneeId ?? null),
    workspaceId: input.workspaceId,
    title: input.title,
    projectId: input.projectId ?? null,
    startAt: input.startAt,
    endAt: input.endAt,
    assigneeId: input.assigneeId ?? null,
    color: input.color ?? null,
    textColor: input.textColor ?? null,
    rowIndex: input.rowIndex ?? 0,
  });
}

export async function updateLCSchedulerSchedule(input: UpdateScheduleInput): Promise<Schedule> {
  const parsed = parseScheduleInstanceId(input.id);
  if (!parsed) throw new Error("LC스케줄러 카드 ID가 올바르지 않습니다");
  const databaseId = makeLCSchedulerDatabaseId(input.workspaceId);
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
  setCell(databaseId, page.id, LC_SCHEDULER_COLUMN_IDS.meta, nextMeta);

  const projected = projectLCSchedulerSchedules(input.workspaceId, useMemberStore.getState().members);
  const schedule = projected.find((item) => item.id === (
    input.assigneeId !== undefined
      ? makeScheduleInstanceId(page.id, input.assigneeId)
      : input.id
  ));
  if (!schedule) throw new Error("LC스케줄러 카드 투영에 실패했습니다");
  return schedule;
}

export async function deleteLCSchedulerSchedule(id: string, workspaceId: string): Promise<void> {
  const parsed = parseScheduleInstanceId(id);
  if (!parsed) throw new Error("LC스케줄러 카드 ID가 올바르지 않습니다");
  const databaseId = makeLCSchedulerDatabaseId(workspaceId);
  useDatabaseStore.getState().deleteRow(databaseId, parsed.pageId);
}
