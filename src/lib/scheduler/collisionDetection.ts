// 같은 멤버·같은 rowIndex 내 날짜 범위 겹침 검사.
import type { Schedule } from "../../store/schedulerStore";

export function hasCollision(target: Schedule, others: Schedule[]): boolean {
  const tStart = new Date(target.startAt).getTime();
  const tEnd = new Date(target.endAt).getTime();
  return others.some((s) => {
    if (s.id === target.id) return false;
    if (s.assigneeId !== target.assigneeId) return false;
    if ((s.rowIndex ?? 0) !== (target.rowIndex ?? 0)) return false;
    const sStart = new Date(s.startAt).getTime();
    const sEnd = new Date(s.endAt).getTime();
    return !(tEnd < sStart || tStart > sEnd);
  });
}

// 멤버별 rowCount 계산 — 같은 일자에 겹치는 일정 수의 최댓값
export function computeRowCount(memberSchedules: Schedule[]): number {
  if (memberSchedules.length === 0) return 1;
  const max = memberSchedules.reduce(
    (acc, s) => Math.max(acc, (s.rowIndex ?? 0) + 1),
    1,
  );
  return Math.max(1, max);
}
