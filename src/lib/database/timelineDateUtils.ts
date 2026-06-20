// DatabaseTimelineView 에서 추출한 순수 날짜/월 유틸 — 로직 변경 없음, 위치만 분리.
// 외부 의존은 timelineGeometry 의 DAY_MS 뿐(부수효과·store·ref 무관).
import { DAY_MS } from "./timelineGeometry";

export const fmtDate = (ts: number) => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

export const toDateIso = (ms: number) => {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const startOfMonth = (t: number) => {
  const d = new Date(t);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export const addMonths = (t: number, delta: number) => {
  const d = new Date(t);
  d.setMonth(d.getMonth() + delta, 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export const endOfMonth = (t: number) => addMonths(startOfMonth(t), 1) - DAY_MS;

export const monthInputToStart = (value: string): number | null => {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m] = match;
  return startOfMonth(new Date(Number(y), Number(m) - 1, 1).getTime());
};

export const monthLabel = (monthStart: number) => {
  const d = new Date(monthStart);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
};
