import type { CellValue, ColumnDef, DatabaseRowView, DateRangeValue } from "../../types/database";

export const DAY_MS = 24 * 60 * 60 * 1000;
// 주 모드: 평일(월~금) 5일 × 3주 = 15 weekdays. 토/일은 시각화 제외.
export const TIMELINE_WEEK_DAYS = 5;
export const TIMELINE_WEEK_RANGE_DAYS = TIMELINE_WEEK_DAYS * 3;
/** 캘린더상의 주 1개(7일) 길이. 주 시작점 계산용. */
export const TIMELINE_WEEK_CAL_DAYS = 7;

/** YYYY-MM-DD 추출. */
export function timelineIsoDate(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

export function timelineStartOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 월요일 시작 기준 주의 시작일(00:00) 반환. */
export function timelineStartOfWeekMon(t: number): number {
  const d = new Date(timelineStartOfDay(t));
  const dow = d.getDay();
  const back = (dow + 6) % 7;
  d.setDate(d.getDate() - back);
  return d.getTime();
}

export function timelineGetRange(
  cell: CellValue,
): { start: number; end: number } | null {
  if (!cell || typeof cell !== "object" || Array.isArray(cell)) return null;
  if (!("start" in cell)) return null;
  const v = cell as DateRangeValue;
  const s = v.start ? Date.parse(v.start) : NaN;
  if (!Number.isFinite(s)) return null;
  const start = timelineStartOfDay(s);
  const e = v.end ? Date.parse(v.end) : NaN;
  const end = Number.isFinite(e) ? timelineStartOfDay(e) : start;
  return { start, end: Math.max(end, start) };
}

/** 16진 컬러 → rgba (카드 배경용). */
export function timelineHexToRgba(hex: string | undefined, alpha: number): string {
  if (!hex) return `rgba(96, 165, 250, ${alpha})`;
  const m = /^#?([\da-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** status/select 첫 옵션 컬러 (없으면 undefined). */
export function timelinePickStatusColor(
  row: DatabaseRowView,
  columns: ColumnDef[],
): string | undefined {
  const col =
    columns.find((c) => c.type === "status") ??
    columns.find((c) => c.type === "select");
  if (!col) return undefined;
  const raw = row.cells[col.id];
  if (typeof raw !== "string") return undefined;
  return col.config?.options?.find((o) => o.id === raw)?.color;
}

/** 주 헤더 라벨 포맷: 평일 첫(월) ~ 마지막(금) — "MM/DD - MM/DD". */
export function timelineWeekLabel(start: number): string {
  const s = new Date(start);
  const e = new Date(start + 4 * DAY_MS);
  return `${s.getMonth() + 1}/${s.getDate()} - ${e.getMonth() + 1}/${e.getDate()}`;
}

/**
 * 주 모드 평일 인덱스(0~14): minT가 지난주 월요일일 때, t가 어느 평일인지 반환.
 * 주말(토/일)이면 -1.
 */
export function timelineWeekdayIndex(t: number, minT: number): number {
  const day = timelineStartOfDay(t);
  const dow = new Date(day).getDay();
  if (dow === 0 || dow === 6) return -1;
  const diffDays = Math.round((day - minT) / DAY_MS);
  if (diffDays < 0 || diffDays >= TIMELINE_WEEK_CAL_DAYS * 3) return -1;
  const weekIdx = Math.floor(diffDays / TIMELINE_WEEK_CAL_DAYS);
  const weekdayInWeek = (dow + 6) % 7;
  if (weekdayInWeek > 4) return -1;
  return weekIdx * TIMELINE_WEEK_DAYS + weekdayInWeek;
}

function nextWeekday(t: number): number {
  let d = timelineStartOfDay(t);
  for (let i = 0; i < 7; i++) {
    const dow = new Date(d).getDay();
    if (dow !== 0 && dow !== 6) return d;
    d += DAY_MS;
  }
  return d;
}

function prevWeekday(t: number): number {
  let d = timelineStartOfDay(t);
  for (let i = 0; i < 7; i++) {
    const dow = new Date(d).getDay();
    if (dow !== 0 && dow !== 6) return d;
    d -= DAY_MS;
  }
  return d;
}

/**
 * 주 모드용: 시작/종료를 가장 가까운 평일로 클램프.
 */
export function timelineClampToWeekday(
  start: number,
  end: number,
): { start: number; end: number } | null {
  const ns = nextWeekday(start);
  const ne = prevWeekday(end);
  if (ns > ne) return null;
  return { start: ns, end: ne };
}
