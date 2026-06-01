// 타임라인 일정 카드의 sticky 텍스트 오프셋을 DOM transform 으로 직접 적용하는 헬퍼.
// 포커싱 애니메이션 중 React 리렌더 없이 매 프레임 호출해 부드럽게 따라오게 한다.
// (컴포넌트가 아닌 함수라 fast-refresh 보존을 위해 TimelineCardText 와 분리한다.)
import { getScheduleCardContentOffset } from "../scheduler/scheduleCardDisplay";

// 카드 텍스트 컨테이너를 식별하는 data 속성 이름. TimelineCardText 의 리터럴과 일치해야 한다.
export const TIMELINE_CARD_TEXT_ATTR = "data-timeline-card-text";

// 컨테이너 안의 모든 카드 텍스트 요소를 찾아 현재 scrollLeft 기준 sticky 오프셋을 적용한다.
// 애니메이션 종료 후에는 caller 가 상태를 1회 동기화해 React 가 동일 값을 다시 설정한다.
export function applyTimelineCardStickyOffset(root: HTMLElement, scrollLeft: number): void {
  const elements = root.querySelectorAll<HTMLElement>(`[${TIMELINE_CARD_TEXT_ATTR}]`);
  elements.forEach((element) => {
    const cardLeft = Number(element.dataset.cardLeft);
    const cardWidth = Number(element.dataset.cardWidth);
    if (!Number.isFinite(cardLeft) || !Number.isFinite(cardWidth)) return;
    const offset = getScheduleCardContentOffset({ scrollLeft, cardLeft, cardWidth });
    element.style.transform = offset ? `translateX(${offset}px)` : "";
  });
}
