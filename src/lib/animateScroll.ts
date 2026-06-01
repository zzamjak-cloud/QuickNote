// 컨테이너의 scrollLeft/scrollTop 을 duration(ms) 동안 easeOutCubic 으로 부드럽게 이동시킨다.
// 네이티브 scrollIntoView 와 달리 ① 지속 시간을 제어할 수 있고 ② 대상 컨테이너만 움직여
// 페이지 전체가 튀지 않는다. 반환된 cancel 로 새 포커싱/언마운트 시 진행 중 애니메이션을 중단한다.
// 성능: 프레임당 scroll 위치 1회 갱신(약 18프레임)이라 비용은 무시할 수준이다.
//
// 주의: `prefers-reduced-motion` 은 의도적으로 무시한다. 이 스크롤은 사용자가 항목을 직접
// 클릭했을 때만 발생하는 짧은 기능성 이동이고, Windows "애니메이션 효과 끄기" 설정이
// 브라우저에 reduced-motion 으로 보고되어 네이티브 smooth 스크롤까지 막아 "순간이동"으로
// 보이는 회귀가 있었다. 사용자가 명시적으로 요청한 연출이라 항상 애니메이션한다.

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function animateScroll(
  el: HTMLElement,
  target: { left?: number; top?: number },
  duration: number,
  onComplete?: () => void,
  // 매 프레임 현재 스크롤 위치로 호출된다. 카드 내부 sticky 텍스트처럼 스크롤에 맞춰
  // 움직여야 하는 요소를 React 리렌더 없이 직접(transform) 갱신하는 용도.
  onFrame?: (pos: { left: number; top: number }) => void,
): { cancel: () => void } {
  const startLeft = el.scrollLeft;
  const startTop = el.scrollTop;
  const targetLeft = target.left ?? startLeft;
  const targetTop = target.top ?? startTop;
  const deltaLeft = targetLeft - startLeft;
  const deltaTop = targetTop - startTop;
  if ((deltaLeft === 0 && deltaTop === 0) || duration <= 0) {
    el.scrollLeft = targetLeft;
    el.scrollTop = targetTop;
    onFrame?.({ left: el.scrollLeft, top: el.scrollTop });
    onComplete?.();
    return { cancel: () => {} };
  }
  let rafId = 0;
  let startTs = 0;
  let done = false;
  const step = (ts: number) => {
    if (!startTs) startTs = ts;
    const progress = Math.min(1, (ts - startTs) / duration);
    const eased = easeOutCubic(progress);
    el.scrollLeft = startLeft + deltaLeft * eased;
    el.scrollTop = startTop + deltaTop * eased;
    onFrame?.({ left: el.scrollLeft, top: el.scrollTop });
    if (progress < 1) {
      rafId = window.requestAnimationFrame(step);
    } else {
      done = true;
      onComplete?.();
    }
  };
  rafId = window.requestAnimationFrame(step);
  return {
    // 취소 시에는 onComplete 를 호출하지 않는다(완료가 아니므로).
    cancel: () => {
      if (rafId && !done) window.cancelAnimationFrame(rafId);
    },
  };
}

// 가로 전용 편의 래퍼. onFrame 은 scrollLeft 만 전달한다.
export function animateScrollLeft(
  el: HTMLElement,
  targetLeft: number,
  duration: number,
  onComplete?: () => void,
  onFrame?: (scrollLeft: number) => void,
): { cancel: () => void } {
  return animateScroll(
    el,
    { left: targetLeft },
    duration,
    onComplete,
    onFrame ? (pos) => onFrame(pos.left) : undefined,
  );
}
