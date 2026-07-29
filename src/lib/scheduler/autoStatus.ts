/**
 * LC스케줄러 상태(status) 자동화 순수 로직.
 * 오늘 날짜 기준: 종료 지남 → 완료(done), 시작 전 → 시작전(todo), 기간 내 → 진행중(progress).
 * "보류(hold)"는 사용자 판단이므로 자동 전이 대상에서 제외하고,
 * 레거시 근태 센티널("leave")은 근태 판정 신호라 덮어쓰면 안 된다.
 */
export type SchedulerAutoStatus = "todo" | "progress" | "done";

const AUTO_STATUS_EXEMPT = new Set(["hold", "leave"]);

/** 자동 전이가 금지된 상태 값인지 판정 */
export function isAutoStatusExempt(status: string | null | undefined): boolean {
  return status != null && AUTO_STATUS_EXEMPT.has(status);
}

/**
 * 일정 기간과 현재 시각으로 자동 상태를 계산한다.
 * startAt/endAt 은 저장 시 로컬 자정/23:59:59 로 정규화된 ISO 문자열이라
 * 회색(지난 카드) 판정과 동일하게 단순 시각 비교로 충분하다.
 */
export function computeScheduleAutoStatus(
  startAt: string,
  endAt: string,
  now: number = Date.now(),
): SchedulerAutoStatus {
  const end = new Date(endAt).getTime();
  if (Number.isFinite(end) && end < now) return "done";
  const start = new Date(startAt).getTime();
  if (Number.isFinite(start) && start > now) return "todo";
  return "progress";
}
