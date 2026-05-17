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

export function groupSchedulesByMember(
  schedules: Schedule[],
  selectedProjectFilterId: string | null,
): GroupedSchedules {
  const schedulesByMember: Record<string, Schedule[]> = {};
  const globalSchedules: Schedule[] = [];
  for (const schedule of schedules) {
    if (selectedProjectFilterId && schedule.projectId !== selectedProjectFilterId) continue;
    if (schedule.assigneeId == null) {
      globalSchedules.push(schedule);
      continue;
    }
    const memberSchedules = schedulesByMember[schedule.assigneeId] ?? [];
    memberSchedules.push(schedule);
    schedulesByMember[schedule.assigneeId] = memberSchedules;
  }
  return { schedulesByMember, globalSchedules };
}
