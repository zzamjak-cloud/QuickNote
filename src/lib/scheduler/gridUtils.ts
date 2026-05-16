// 픽셀 ↔ 날짜 인덱스 변환 헬퍼.
import { startOfYear, startOfDay, daysInYear } from "./dateUtils";

export function dateToX(year: number, date: Date, cellWidth: number): number {
  const start = startOfYear(year).getTime();
  const ms = startOfDay(date).getTime() - start;
  const idx = Math.floor(ms / 86400000);
  return idx * cellWidth;
}

export function xToDate(year: number, x: number, cellWidth: number): Date {
  const idx = Math.max(0, Math.min(daysInYear(year) - 1, Math.floor(x / cellWidth)));
  const start = startOfYear(year);
  start.setDate(start.getDate() + idx);
  return start;
}

export function widthForRange(startDate: Date, endDate: Date, cellWidth: number): number {
  const a = startOfDay(startDate).getTime();
  const b = startOfDay(endDate).getTime();
  const days = Math.max(1, Math.round((b - a) / 86400000) + 1);
  return days * cellWidth;
}

// 카드 가시 영역 계산 — 1년 그리드 밖으로 나간 부분은 잘라낸다.
export function clampVisibleRange(
  year: number,
  startDate: Date,
  endDate: Date,
): { startIdx: number; endIdx: number } | null {
  const total = daysInYear(year);
  const startMs = startOfDay(startDate).getTime();
  const endMs = startOfDay(endDate).getTime();
  const yearStart = startOfYear(year).getTime();
  const startIdx = Math.floor((startMs - yearStart) / 86400000);
  const endIdx = Math.floor((endMs - yearStart) / 86400000);
  const a = Math.max(0, startIdx);
  const b = Math.min(total - 1, endIdx);
  if (b < 0 || a > total - 1) return null;
  return { startIdx: a, endIdx: b };
}
