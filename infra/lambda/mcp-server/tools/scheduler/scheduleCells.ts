// 스케줄러 작업 행 셀 계산(순수) — 클라 taskAdapter.createLCSchedulerSchedule·updateLCSchedulerSchedule 규칙을 서버에서 재현한다.
// 프리셋·근태 기본값·meta·색상·auto-status·담당자 인스턴스 교체. 날짜 경계는 KST(람다는 UTC 로 돈다).
import { computeScheduleAutoStatus, isAutoStatusExempt } from "../../../../../src/lib/scheduler/autoStatus";
import { pickTextColor } from "../../../../../src/lib/scheduler/colors";
import {
  LC_SCHEDULER_ATTENDANCE_PRESET_ID,
  LC_SCHEDULER_ATTENDANCE_TITLE,
  LC_SCHEDULER_COLUMN_IDS as COL,
  LC_SCHEDULER_TASK_PRESET_ID,
  getLCSchedulerAttendanceLabel,
  lcSchedulerAttendancePresetDefaults,
  lcSchedulerTaskPresetDefaults,
  normalizeLCSchedulerAttendanceValue,
  type LCSchedulerAttendanceValue,
} from "../../../../../src/lib/scheduler/schedulerSchema";
import {
  parseSchedulerTaskMeta,
  setSchedulerTaskCardColor,
  setSchedulerTaskRowIndex,
  type SchedulerTaskMeta,
} from "../../../../../src/lib/scheduler/taskMeta";
import { ToolError } from "../../context";

type Cells = Record<string, unknown>;

/** 앱의 특수(담당자 없음) 일정 색 — taskAdapter.resolveCreateColor. */
export const GLOBAL_SCHEDULE_COLOR = "#f59e0b";
export const SCHEDULE_STATUSES = ["todo", "progress", "done", "hold"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 클라 toIsoStartOfDay(KST 로컬 자정)와 같은 UTC ISO. */
export function kstStartIso(ymd: string): string {
  return new Date(`${ymd}T00:00:00.000+09:00`).toISOString();
}

/** 클라 toIsoEndOfDay(KST 23:59:59.999)와 같은 UTC ISO. */
export function kstEndIso(ymd: string): string {
  return new Date(`${ymd}T23:59:59.999+09:00`).toISOString();
}

/** ISO 시각의 KST 날짜(YYYY-MM-DD). */
export function kstYmd(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10) : iso;
}

/** 실재하는 YYYY-MM-DD 인지(2026-02-30 같은 값 거부). */
export function assertYmd(value: string, field: string): void {
  const valid = YMD.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000+09:00`)) && kstYmd(kstStartIso(value)) === value;
  if (!valid) throw new ToolError(`${field} must be a valid YYYY-MM-DD date`);
}

/** KST 날짜 n 일 이동. */
export function shiftYmd(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function asDateRange(value: unknown): { start: string; end: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const range = value as { start?: unknown; end?: unknown };
  if (typeof range.start !== "string") return null;
  return { start: range.start, end: typeof range.end === "string" ? range.end : range.start };
}

/** 클라 normalizeAssignees(멤버 목록 없이) — 문자열 배열·쉼표 문자열 모두 허용, 중복 제거. */
export function assigneeIdsOf(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string").map((v) => v.trim())
    : typeof value === "string" ? value.split(/[,\n]/).map((v) => v.trim()) : [];
  return Array.from(new Set(raw.filter(Boolean)));
}

/** meta 의 undefined 키 제거(Y 룸·JSON 저장용). */
function cleanMeta(meta: SchedulerTaskMeta): Cells {
  return Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined));
}

/** 근태 값에 맞춘 meta(kind·annualLeave·attendanceValue). null 이면 일정 kind 로 되돌린다. */
function metaForAttendance(meta: SchedulerTaskMeta, attendance: LCSchedulerAttendanceValue | null): SchedulerTaskMeta {
  if (attendance) return { ...meta, kind: "leave", annualLeave: attendance === "annual-leave", attendanceValue: attendance };
  const { annualLeave: _annualLeave, attendanceValue: _attendanceValue, ...rest } = meta;
  return { ...rest, kind: "schedule" };
}

/** 클라 applyScheduleAutoStatus — 보류·레거시 leave·근태 행·meta.kind leave 는 건드리지 않는다. */
export function autoStatusFor(cells: Cells, now: number): ScheduleStatus | null {
  const status = asString(cells[COL.status]);
  if (isAutoStatusExempt(status)) return null;
  if (normalizeLCSchedulerAttendanceValue(asString(cells[COL.attendance]))) return null;
  const meta = parseSchedulerTaskMeta(cells[COL.meta]);
  if (meta.kind === "leave" || meta.attendanceValue) return null;
  const range = asDateRange(cells[COL.period]);
  if (!range?.start) return null;
  const next = computeScheduleAutoStatus(range.start, range.end, now);
  return next === status ? null : next;
}

/** DB 레코드 presets(JSON 문자열/배열)에서 프리셋 columnDefaults. 없으면 시드 기본값(앱 시드와 같은 정의). */
export function presetDefaults(rawPresets: unknown, attendance: boolean): Cells {
  const presetId = attendance ? LC_SCHEDULER_ATTENDANCE_PRESET_ID : LC_SCHEDULER_TASK_PRESET_ID;
  let list: unknown = rawPresets;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      list = [];
    }
  }
  const found = Array.isArray(list)
    ? list.find((p): p is { id: string; columnDefaults?: unknown } => Boolean(p) && typeof p === "object" && (p as { id?: unknown }).id === presetId)
    : undefined;
  const defaults = found?.columnDefaults;
  if (defaults && typeof defaults === "object" && !Array.isArray(defaults)) return structuredClone(defaults as Cells);
  return attendance ? lcSchedulerAttendancePresetDefaults() : lcSchedulerTaskPresetDefaults();
}

export type ScheduleCreateFields = {
  title?: string;
  startDate: string;
  endDate?: string;
  assigneeId: string | null;
  projectId?: string | null;
  organizationId?: string | null;
  teamId?: string | null;
  status?: ScheduleStatus;
  attendance?: LCSchedulerAttendanceValue | null;
  color?: string | null;
  textColor?: string | null;
  rowIndex?: number;
  milestoneId?: string | null;
  featureId?: string | null;
};

function setOrDelete(cells: Cells, columnId: string, value: unknown): void {
  if (value === null || value === undefined) delete cells[columnId];
  else cells[columnId] = value;
}

function linkValue(id: string | null | undefined): string[] | null | undefined {
  return id === undefined ? undefined : id === null ? null : [id];
}

/**
 * 신규 행 셀 — 프리셋(일정/근태) → 근태 기본값 → 범위(조직·팀·프로젝트) → 제목·기간·담당자·색·meta → auto-status.
 * 앱의 "마지막 속성값 기억"(브라우저 로컬)은 서버에 없어 적용하지 않는다.
 */
export function buildCreateCells(rawPresets: unknown, input: ScheduleCreateFields, now: number): { title: string; cells: Cells } {
  const titleIn = input.title?.trim();
  const attendance = input.attendance ?? null;
  const isAttendance = attendance !== null || titleIn === LC_SCHEDULER_ATTENDANCE_TITLE || titleIn === "연차";
  const defaults = presetDefaults(rawPresets, isAttendance);
  const presetTitle = asString(defaults[COL.title]);
  const cells: Cells = {};
  for (const [columnId, value] of Object.entries(defaults)) {
    if (columnId !== COL.title && value !== null && value !== undefined) cells[columnId] = value;
  }
  let meta = parseSchedulerTaskMeta(cells[COL.meta]);
  if (isAttendance) {
    const value = attendance ?? normalizeLCSchedulerAttendanceValue(asString(cells[COL.attendance])) ?? "annual-leave";
    cells[COL.attendance] = value;
    meta = metaForAttendance(meta, value);
  }
  const title = isAttendance
    ? getLCSchedulerAttendanceLabel(asString(cells[COL.attendance])) ?? "연차"
    : titleIn || presetTitle || "일정";

  setOrDelete(cells, COL.project, input.projectId);
  setOrDelete(cells, COL.organization, input.organizationId);
  setOrDelete(cells, COL.team, input.teamId);
  setOrDelete(cells, COL.milestone, linkValue(input.milestoneId));
  setOrDelete(cells, COL.feature, linkValue(input.featureId));
  cells[COL.period] = { start: kstStartIso(input.startDate), end: kstEndIso(input.endDate ?? input.startDate) };
  cells[COL.assignees] = input.assigneeId ? [input.assigneeId] : [];

  // 앱: 담당자 없는 특수 일정은 주황 고정. 명시 색은 그대로 쓴다.
  const color = input.color !== undefined ? input.color : input.assigneeId === null ? GLOBAL_SCHEDULE_COLOR : null;
  setOrDelete(cells, COL.color, color);
  const textColor = input.textColor !== undefined ? input.textColor : color ? pickTextColor(color) : null;
  meta = setSchedulerTaskRowIndex({ ...meta, textColor }, input.assigneeId, input.rowIndex ?? 0);
  cells[COL.meta] = cleanMeta(meta);

  if (input.status) cells[COL.status] = input.status;
  else {
    const auto = autoStatusFor(cells, now);
    if (auto) cells[COL.status] = auto;
  }
  return { title, cells };
}

export type ScheduleUpdateFields = Partial<Omit<ScheduleCreateFields, "startDate" | "assigneeId">> & {
  startDate?: string;
  /** 이 카드의 담당자를 교체(null = 담당자 전부 해제 → 특수 일정, 앱 replaceAssignee 와 같다). */
  assigneeId?: string | null;
  /** row = 행 전체 색, card = 이 담당자 카드만. 생략 시 다중 담당자 행이면 카드 색. */
  colorScope?: "row" | "card";
};

/** 앱 replaceAssignee. */
function replaceAssignee(current: string[], from: string | null, to: string | null | undefined): string[] {
  if (to === undefined) return current;
  if (to === null) return [];
  const next = current.filter((item) => item !== from);
  if (!next.includes(to)) next.push(to);
  return next;
}

/**
 * 기존 행 갱신 — 바뀐 셀만 patch 로 돌려준다(undefined = 셀 삭제). 기간이 바뀌면 auto-status(명시 status 우선).
 * instanceAssigneeId 는 카드 id 의 담당자(null = 특수 일정 카드).
 */
export function buildUpdateCells(
  current: Cells,
  instanceAssigneeId: string | null,
  input: ScheduleUpdateFields,
  now: number,
): { title?: string; patch: Cells; nextInstanceAssigneeId: string | null } {
  const next: Cells = { ...current };
  const patch: Cells = {};
  const set = (columnId: string, value: unknown) => {
    const v = value === null ? undefined : value;
    patch[columnId] = v;
    if (v === undefined) delete next[columnId];
    else next[columnId] = v;
  };

  if (input.startDate !== undefined || input.endDate !== undefined) {
    const prev = asDateRange(current[COL.period]);
    const start = input.startDate !== undefined ? kstStartIso(input.startDate) : prev?.start;
    if (!start) throw new ToolError("startDate is required: this schedule has no period yet");
    const end = input.endDate !== undefined ? kstEndIso(input.endDate) : prev?.end ?? kstEndIso(kstYmd(start));
    if (Date.parse(end) < Date.parse(start)) throw new ToolError("endDate must be on or after startDate");
    set(COL.period, { start, end });
  }
  if (input.projectId !== undefined) set(COL.project, input.projectId);
  if (input.organizationId !== undefined) set(COL.organization, input.organizationId);
  if (input.teamId !== undefined) set(COL.team, input.teamId);
  if (input.milestoneId !== undefined) set(COL.milestone, linkValue(input.milestoneId));
  if (input.featureId !== undefined) set(COL.feature, linkValue(input.featureId));
  if (input.assigneeId !== undefined) {
    set(COL.assignees, replaceAssignee(assigneeIdsOf(current[COL.assignees]), instanceAssigneeId, input.assigneeId));
  }

  let meta = parseSchedulerTaskMeta(current[COL.meta]);
  let title: string | undefined = input.title?.trim() || undefined;
  if (input.attendance !== undefined) {
    set(COL.attendance, input.attendance);
    meta = metaForAttendance(meta, input.attendance);
    if (input.attendance && title === undefined) title = getLCSchedulerAttendanceLabel(input.attendance) ?? undefined;
  }

  const targetAssigneeId = input.assigneeId !== undefined ? input.assigneeId : instanceAssigneeId;
  const assigneeCount = assigneeIdsOf(next[COL.assignees]).length;
  const textColor = input.textColor !== undefined ? input.textColor : input.color ? pickTextColor(input.color) : input.color;
  const cardOverride = input.color !== undefined && input.colorScope !== "row"
    && (input.colorScope === "card" || (targetAssigneeId !== null && assigneeCount > 1));
  if (input.color !== undefined && !cardOverride) set(COL.color, input.color);
  if (cardOverride) meta = setSchedulerTaskCardColor(meta, targetAssigneeId, input.color, textColor);
  else if (textColor !== undefined) meta = { ...meta, textColor };
  meta = setSchedulerTaskRowIndex(meta, targetAssigneeId, input.rowIndex);
  const metaChanged = JSON.stringify(cleanMeta(meta)) !== JSON.stringify(cleanMeta(parseSchedulerTaskMeta(current[COL.meta])));
  if (metaChanged) set(COL.meta, cleanMeta(meta));

  if (input.status !== undefined) set(COL.status, input.status);
  else if (COL.period in patch || COL.attendance in patch) {
    const auto = autoStatusFor(next, now);
    if (auto) set(COL.status, auto);
  }
  return { ...(title !== undefined ? { title } : {}), patch, nextInstanceAssigneeId: targetAssigneeId };
}
