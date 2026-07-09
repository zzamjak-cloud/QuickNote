// 블록 그립 네이티브 드래그 중, 커서가 스크롤 컨테이너 상/하단 가장자리에 닿으면
// 자동으로 스크롤한다. HTML5 drag 는 커스텀 스크롤 컨테이너를 자동 스크롤해 주지 않으므로 직접 처리.

const EDGE_PX = 72; // 가장자리 감지 영역 두께
const MAX_SPEED_PX = 22; // 프레임당 최대 스크롤 픽셀

/**
 * 드래그 자동 스크롤을 시작한다. 반환된 함수를 호출해 정리할 수 있으나,
 * dragend/drop/pointerup 에서 스스로도 종료한다(그립 버튼이 드래그 중 언마운트되어
 * 호출부의 onDragEnd 가 발화하지 않아도 무한 스크롤이 남지 않도록).
 * scroller 가 null 이면 문서(window) 스크롤을 사용한다.
 */
export function startBlockDragAutoScroll(
  scroller: HTMLElement | null,
): () => void {
  if (typeof window === "undefined") return () => {};

  // 문서 스크롤 대상 판별 — 별도 오버플로 컨테이너가 없으면 window.
  const useWindow =
    !scroller || scroller === document.scrollingElement || scroller === document.body;

  let velocity = 0;
  let rafId: number | null = null;
  let stopped = false;

  const step = () => {
    if (stopped) return;
    if (velocity !== 0) {
      if (useWindow) window.scrollBy(0, velocity);
      else if (scroller) scroller.scrollTop += velocity;
    }
    rafId = window.requestAnimationFrame(step);
  };

  const onDragOver = (e: DragEvent) => {
    const top = useWindow ? 0 : scroller!.getBoundingClientRect().top;
    const bottom = useWindow
      ? window.innerHeight
      : scroller!.getBoundingClientRect().bottom;
    const y = e.clientY;
    if (y < top + EDGE_PX) {
      const ratio = Math.min(1, (top + EDGE_PX - y) / EDGE_PX);
      velocity = -MAX_SPEED_PX * ratio;
    } else if (y > bottom - EDGE_PX) {
      const ratio = Math.min(1, (y - (bottom - EDGE_PX)) / EDGE_PX);
      velocity = MAX_SPEED_PX * ratio;
    } else {
      velocity = 0;
    }
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    velocity = 0;
    document.removeEventListener("dragover", onDragOver, true);
    document.removeEventListener("dragend", stop, true);
    document.removeEventListener("drop", stop, true);
    window.removeEventListener("pointerup", stop, true);
    if (rafId != null) window.cancelAnimationFrame(rafId);
    rafId = null;
  };

  document.addEventListener("dragover", onDragOver, true);
  // 드래그 종료를 스스로 감지해 정리(호출부 onDragEnd 누락 대비 이중 안전장치).
  document.addEventListener("dragend", stop, true);
  document.addEventListener("drop", stop, true);
  window.addEventListener("pointerup", stop, true);
  rafId = window.requestAnimationFrame(step);

  return stop;
}
