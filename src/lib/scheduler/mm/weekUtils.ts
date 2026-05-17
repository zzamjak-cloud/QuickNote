import { addDays, startOfDay, startOfWeek } from "../dateUtils";

export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseDateKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

export function getWeekEndDate(weekStartKey: string): Date {
  return addDays(parseDateKey(weekStartKey), 4);
}

export function getWeekEndKey(weekStartKey: string): string {
  return toDateKey(getWeekEndDate(weekStartKey));
}

export function getDefaultMmWeek(today = new Date()): string {
  return toDateKey(addDays(startOfWeek(today), -7));
}

export function shiftMmWeek(weekStartKey: string, weeks: number): string {
  return toDateKey(addDays(parseDateKey(weekStartKey), weeks * 7));
}

export function eachWorkdayInWeek(weekStartKey: string): Date[] {
  const start = parseDateKey(weekStartKey);
  return [0, 1, 2, 3, 4].map((offset) => addDays(start, offset));
}

export function getMmWeekLabel(weekStartKey: string, today = new Date()): string {
  const start = parseDateKey(weekStartKey);
  const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
  const firstWeekStart = startOfWeek(monthStart);
  const weekNo = Math.floor((startOfDay(start).getTime() - firstWeekStart.getTime()) / (7 * 86400000)) + 1;
  const currentWeekKey = toDateKey(startOfWeek(today));
  const relation = (() => {
    if (weekStartKey === currentWeekKey) return "이번주";
    if (weekStartKey === shiftMmWeek(currentWeekKey, -1)) return "지난주";
    if (weekStartKey === shiftMmWeek(currentWeekKey, 1)) return "다음주";
    return parseDateKey(weekStartKey).getTime() < parseDateKey(currentWeekKey).getTime()
      ? "과거"
      : "미래";
  })();
  return `${start.getMonth() + 1}월 ${weekNo}주차(${relation})`;
}

export function weeksInMonth(year: number, monthIndex: number): string[] {
  const start = startOfWeek(new Date(year, monthIndex, 1));
  const end = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
  const out: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    out.push(toDateKey(cursor));
    cursor = addDays(cursor, 7);
  }
  return out;
}

export function weeksInYear(year: number): string[] {
  const start = startOfWeek(new Date(year, 0, 1));
  const end = new Date(year, 11, 31, 23, 59, 59, 999);
  const out: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    out.push(toDateKey(cursor));
    cursor = addDays(cursor, 7);
  }
  return out;
}
