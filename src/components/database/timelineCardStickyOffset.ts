// 타임라인 일정 카드의 sticky 텍스트 오프셋을 DOM transform 으로 직접 적용하는 헬퍼.
// 포커싱 애니메이션 중 React 리렌더 없이 매 프레임 호출해 부드럽게 따라오게 한다.
// (컴포넌트가 아닌 함수라 fast-refresh 보존을 위해 TimelineCardText 와 분리한다.)
import { getScheduleCardContentOffset } from "../scheduler/scheduleCardDisplay";

// 카드 텍스트 컨테이너를 식별하는 data 속성 이름. TimelineCardText 의 리터럴과 일치해야 한다.
export const TIMELINE_CARD_TEXT_ATTR = "data-timeline-card-text";

// 날짜 미등록(흰색) 카드 루트를 식별하는 data 속성 — 값은 기준 left(px).
export const TIMELINE_UNSCHEDULED_CARD_ATTR = "data-unscheduled-card";

// 컨테이너 안의 모든 카드 텍스트 요소를 찾아 현재 scrollLeft 기준 sticky 오프셋을 적용한다.
// 애니메이션 종료 후에는 caller 가 상태를 1회 동기화해 React 가 동일 값을 다시 설정한다.
export function applyTimelineCardStickyOffset(root: HTMLElement, scrollLeft: number): void {
  const elements = root.querySelectorAll<HTMLElement>(`[${TIMELINE_CARD_TEXT_ATTR}]`);
  elements.forEach((element) => {
    // 미등록(흰색) 카드는 카드 통째로 화면 고정되므로 내부 텍스트 sticky 오프셋은 적용하지 않는다.
    // (고정된 stale cardLeft 로 계산하면 텍스트만 흔들리는 문제가 생긴다.)
    if (element.closest(`[${TIMELINE_UNSCHEDULED_CARD_ATTR}]`)) {
      element.style.transform = "";
      return;
    }
    const cardLeft = Number(element.dataset.cardLeft);
    const cardWidth = Number(element.dataset.cardWidth);
    if (!Number.isFinite(cardLeft) || !Number.isFinite(cardWidth)) return;
    const offset = getScheduleCardContentOffset({ scrollLeft, cardLeft, cardWidth });
    element.style.transform = offset ? `translateX(${offset}px)` : "";
  });
}

// 미등록 카드를 항목열 우측에 화면 고정한다. 포커싱 애니메이션 중에는 React 상태(scrollLeft)가
// 동결되어 카드가 트랙과 함께 밀렸다가 종료 시 튀는(깜빡) 문제가 있으므로, 매 프레임 라이브
// scrollLeft 로 직접 transform 을 잡아 흔들림 없이 같은 화면 위치를 유지시킨다.
export function applyUnscheduledCardPin(root: HTMLElement, scrollLeft: number): void {
  const elements = root.querySelectorAll<HTMLElement>(`[${TIMELINE_UNSCHEDULED_CARD_ATTR}]`);
  elements.forEach((element) => {
    const base = Number(element.dataset.unscheduledCard);
    const top = Number(element.dataset.cardTop);
    if (!Number.isFinite(base) || !Number.isFinite(top)) return;
    element.style.transform = `translate(${scrollLeft + base}px, ${top}px)`;
  });
}
