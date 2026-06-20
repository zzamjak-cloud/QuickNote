// DatabaseTimelineView 박스 선택/포인터 기하 유틸 — 순수 함수, 로직 변경 없음.
// 외부 store/ref/state 의존 없음(DOM 판별·사각형 교차 계산만).

export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "button, input, textarea, select, [contenteditable='true'], [role='textbox'], [data-db-timeline-card='true']",
    ),
  );
}

export function rectsIntersect(
  selLeft: number,
  selRight: number,
  selTop: number,
  selBottom: number,
  cardLeft: number,
  cardRight: number,
  cardTop: number,
  cardBottom: number,
): boolean {
  return cardLeft < selRight && cardRight > selLeft && cardTop < selBottom && cardBottom > selTop;
}
