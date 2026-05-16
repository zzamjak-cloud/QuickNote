// LC 스케줄러 날짜 유틸 — 연간 그리드의 일 인덱스 계산.
export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function startOfYear(year: number): Date {
  return new Date(year, 0, 1, 0, 0, 0, 0);
}

export function endOfYear(year: number): Date {
  return new Date(year, 11, 31, 23, 59, 59, 999);
}

export function daysInYear(year: number): number {
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return isLeap ? 366 : 365;
}

export function dayIndex(year: number, date: Date): number {
  const start = startOfYear(year).getTime();
  const ms = startOfDay(date).getTime() - start;
  return Math.floor(ms / 86400000);
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isWeekend(d: Date): boolean {
  const w = d.getDay();
  return w === 0 || w === 6;
}

export function firstDayOfMonthIndices(year: number): number[] {
  const out: number[] = [];
  for (let m = 0; m < 12; m++) {
    out.push(dayIndex(year, new Date(year, m, 1)));
  }
  return out;
}

export function weekendIndices(year: number): number[] {
  const out: number[] = [];
  const total = daysInYear(year);
  const start = startOfYear(year);
  for (let i = 0; i < total; i++) {
    if (isWeekend(addDays(start, i))) out.push(i);
  }
  return out;
}

export function todayIndex(year: number): number | null {
  const now = startOfDay(new Date());
  if (now.getFullYear() !== year) return null;
  return dayIndex(year, now);
}

// 월요일 시작 주의 시작일 반환
export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const w = x.getDay();
  const diff = w === 0 ? -6 : 1 - w;
  return addDays(x, diff);
}

export function formatKoreanDate(d: Date): string {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export function formatShortDate(d: Date): string {
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

// ISO 문자열을 로컬 Date 로 안전 변환
export function parseIsoDate(s: string): Date {
  return new Date(s);
}

export function toIsoStartOfDay(d: Date): string {
  const x = startOfDay(d);
  return x.toISOString();
}

export function toIsoEndOfDay(d: Date): string {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.toISOString();
}
