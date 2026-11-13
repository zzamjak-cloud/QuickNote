// 스케줄러 작업 DB 스키마 상수·순수 함수 — 클라(src)와 MCP 서버(infra/lambda/mcp-server)가 함께 import 한다.
// 스토어·브라우저 의존 import 금지(람다 번들·infra tsc 가 이 파일을 그대로 컴파일한다).
import type { CellValue } from "../../types/database";
import { LC_SCHEDULER_WORKSPACE_ID } from "./scope";

export const LC_SCHEDULER_DATABASE_ID_PREFIX = "lc-scheduler-db:";
export const LC_SCHEDULER_DATABASE_ID = `${LC_SCHEDULER_DATABASE_ID_PREFIX}${LC_SCHEDULER_WORKSPACE_ID}`;
export const LC_MILESTONE_DATABASE_ID = `lc-milestone-db:${LC_SCHEDULER_WORKSPACE_ID}`;
export const LC_FEATURE_DATABASE_ID = `lc-feature-db:${LC_SCHEDULER_WORKSPACE_ID}`;
export const LC_SCHEDULER_TASK_PRESET_ID = "lc-scheduler-preset:task";
export const LC_SCHEDULER_ATTENDANCE_PRESET_ID = "lc-scheduler-preset:annual-leave";

export const LC_SCHEDULER_COLUMN_IDS = {
  title: "lc-scheduler:title",
  assignees: "lc-scheduler:assignees",
  period: "lc-scheduler:period",
  project: "lc-scheduler:project",
  status: "lc-scheduler:status",
  attendance: "lc-scheduler:attendance",
  organization: "lc-scheduler:organization",
  team: "lc-scheduler:team",
  milestone: "lc-scheduler:milestone",
  version: "lc-scheduler:version",
  feature: "lc-scheduler:feature",
  color: "lc-scheduler:color",
  meta: "lc-scheduler:meta",
} as const;

export const LC_SCHEDULER_ATTENDANCE_TITLE = "근태";

export const LC_SCHEDULER_ATTENDANCE_OPTIONS = [
  { id: "annual-leave", label: "연차", color: "#e74c3c", dayValue: 1 },
  { id: "morning-half-day", label: "오전반차", color: "#f97316", dayValue: 0.5 },
  { id: "afternoon-half-day", label: "오후반차", color: "#f59e0b", dayValue: 0.5 },
  { id: "morning-quarter-day", label: "오전반반차", color: "#a855f7", dayValue: 0.25 },
  { id: "afternoon-quarter-day", label: "오후반반차", color: "#8b5cf6", dayValue: 0.25 },
  { id: "hourly-leave-30m", label: "시간차(30분)", color: "#06b6d4", dayValue: 0.0625 },
  { id: "hourly-leave-1h", label: "시간차(1시간)", color: "#0891b2", dayValue: 0.125 },
  { id: "hourly-leave-90m", label: "시간차(1시간 30분)", color: "#0e7490", dayValue: 0.1875 },
] as const;

export type LCSchedulerAttendanceValue = typeof LC_SCHEDULER_ATTENDANCE_OPTIONS[number]["id"];

const LEGACY_ATTENDANCE_VALUE_MAP: Record<string, LCSchedulerAttendanceValue> = {
  "hourly-leave": "hourly-leave-1h",
};

export function normalizeLCSchedulerAttendanceValue(value: string | null | undefined): LCSchedulerAttendanceValue | null {
  if (!value) return null;
  if (LC_SCHEDULER_ATTENDANCE_OPTIONS.some((option) => option.id === value)) {
    return value as LCSchedulerAttendanceValue;
  }
  return LEGACY_ATTENDANCE_VALUE_MAP[value] ?? null;
}

export function isLCSchedulerAttendanceValue(value: string | null | undefined): value is LCSchedulerAttendanceValue {
  return LC_SCHEDULER_ATTENDANCE_OPTIONS.some((option) => option.id === value);
}

export function getLCSchedulerAttendanceLabel(value: string | null | undefined): string | null {
  const normalized = normalizeLCSchedulerAttendanceValue(value);
  return LC_SCHEDULER_ATTENDANCE_OPTIONS.find((option) => option.id === normalized)?.label ?? null;
}

export function getLCSchedulerAttendanceDayValue(value: string | null | undefined): number | null {
  const normalized = normalizeLCSchedulerAttendanceValue(value);
  return LC_SCHEDULER_ATTENDANCE_OPTIONS.find((option) => option.id === normalized)?.dayValue ?? null;
}

/** "일정" 프리셋 기본 셀(title 컬럼 값은 페이지 제목). 호출마다 새 객체 — 공유 상수 변형 방지. */
export function lcSchedulerTaskPresetDefaults(): Record<string, CellValue> {
  return {
    [LC_SCHEDULER_COLUMN_IDS.title]: "일정",
    [LC_SCHEDULER_COLUMN_IDS.status]: "todo",
    [LC_SCHEDULER_COLUMN_IDS.attendance]: null,
    [LC_SCHEDULER_COLUMN_IDS.color]: "#3498DB",
    [LC_SCHEDULER_COLUMN_IDS.meta]: { kind: "schedule" },
  };
}

/** "근태" 프리셋 기본 셀. */
export function lcSchedulerAttendancePresetDefaults(): Record<string, CellValue> {
  return {
    [LC_SCHEDULER_COLUMN_IDS.title]: "연차",
    [LC_SCHEDULER_COLUMN_IDS.status]: "todo",
    [LC_SCHEDULER_COLUMN_IDS.attendance]: "annual-leave",
    [LC_SCHEDULER_COLUMN_IDS.color]: "#E74C3C",
    [LC_SCHEDULER_COLUMN_IDS.meta]: { kind: "leave", annualLeave: true, attendanceValue: "annual-leave" },
  };
}

// 카드(인스턴스) id = 행 페이지 id + "::" + 담당자 id(없으면 __global__). 서버 Schedules 색인 id 와 같다.
const INSTANCE_SEPARATOR = "::";
export const GLOBAL_ASSIGNEE_ID = "__global__";

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
