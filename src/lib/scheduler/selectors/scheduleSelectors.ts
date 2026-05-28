import type { Schedule } from "../../../store/schedulerStore";

export type GroupedSchedules = {
  schedulesByMember: Record<string, Schedule[]>;
  globalSchedules: Schedule[];
};

export function scheduleOverlapsRange(schedule: Schedule, from: string, to: string): boolean {
  const start = Date.parse(schedule.startAt);
  const end = Date.parse(schedule.endAt);
  const rangeStart = Date.parse(from);
  const rangeEnd = Date.parse(to);
  if ([start, end, rangeStart, rangeEnd].some((value) => Number.isNaN(value))) return true;
  return start < rangeEnd && end > rangeStart;
}

export function filterSchedulesByRange(schedules: Schedule[], from?: string, to?: string): Schedule[] {
  if (!from || !to) return schedules;
  return schedules.filter((schedule) => scheduleOverlapsRange(schedule, from, to));
}

/** 선택된 스코프("org:id" | "team:id" | "proj:id")에 특이사항이 속하는지 검사 */
function matchesScope(schedule: Schedule, scopeKey: string): boolean {
  if (scopeKey.startsWith("proj:")) {
    return schedule.projectId === scopeKey.slice(5);
  }
  if (scopeKey.startsWith("team:")) {
    // 팀 특이사항 — 해당 팀 소속이며 특정 프로젝트에 귀속되지 않음
    return schedule.teamId === scopeKey.slice(5) && !schedule.projectId;
  }
  if (scopeKey.startsWith("org:")) {
    // 조직 특이사항 — 해당 조직 소속이며 팀/프로젝트에 귀속되지 않음
    return (
      schedule.organizationId === scopeKey.slice(4) &&
      !schedule.teamId &&
      !schedule.projectId
    );
  }
  return false;
}

export function groupSchedulesByMember(
  schedules: Schedule[],
  selectedScopeKey: string | null,
): GroupedSchedules {
  const schedulesByMember: Record<string, Schedule[]> = {};
  const globalSchedules: Schedule[] = [];
  for (const schedule of schedules) {
    if (schedule.assigneeId == null) {
      // 선택된 스코프(조직·팀·프로젝트)에 속하는 특이사항만 포함
      if (!selectedScopeKey || !matchesScope(schedule, selectedScopeKey)) continue;
      globalSchedules.push(schedule);
      continue;
    }
    const memberSchedules = schedulesByMember[schedule.assigneeId] ?? [];
    memberSchedules.push(schedule);
    schedulesByMember[schedule.assigneeId] = memberSchedules;
  }
  return { schedulesByMember, globalSchedules };
}
