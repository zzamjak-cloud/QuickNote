import {
  isLikelyVerticalScrollbarInput,
  markProgrammaticScroll,
  suppressScrollRestoreFor,
} from "../navigation/pageScrollMemory";

type PreserveMediaScrollOptions = {
  durationMs?: number;
};

const DEFAULT_DURATION_MS = 3000;
const SCROLL_EPSILON_PX = 1;
const RESTORE_SUPPRESS_MS = 900;

export function findMediaScrollHost(element: HTMLElement | null): HTMLElement | null {
  if (!element) return null;
  return (
    element.closest<HTMLElement>(".qn-editor-body-scroll") ??
    element.closest<HTMLElement>("[data-qn-scroll-page-id]") ??
    element.closest<HTMLElement>(".overflow-y-auto")
  );
}

function isUpwardScrollKey(key: string): boolean {
  return key === "ArrowUp" || key === "PageUp" || key === "Home";
}

/**
 * iframe/img 활성화 직후 브라우저 스크롤 앵커링이나 외부 로드가 위쪽 점프를 만들면 복구한다.
 * 아래쪽 스크롤은 최신 위치를 기준으로 갱신하고, 명시적인 위쪽 입력이 들어오면 즉시 양보한다.
 */
export function preserveMediaScrollPosition(
  element: HTMLElement | null,
  options: PreserveMediaScrollOptions = {},
): (() => void) | null {
  if (typeof window === "undefined") return null;
  const scroller = findMediaScrollHost(element);
  if (!scroller || scroller.scrollTop <= SCROLL_EPSILON_PX) return null;
  const scrollHost = scroller;

  const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
  const startedAt = window.performance.now();
  let baselineTop = scrollHost.scrollTop;
  let animationFrame: number | null = null;
  let stopped = false;
  let lastTouchY: number | null = null;

  const cleanup = () => {
    scrollHost.removeEventListener("wheel", onWheel, true);
    scrollHost.removeEventListener("touchstart", onTouchStart, true);
    scrollHost.removeEventListener("touchmove", onTouchMove, true);
    scrollHost.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("keydown", onKeyDown, true);
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (animationFrame != null) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
    cleanup();
  };

  function onWheel(event: WheelEvent): void {
    if (event.deltaY < -SCROLL_EPSILON_PX) stop();
  }

  function onTouchStart(event: TouchEvent): void {
    lastTouchY = event.touches[0]?.clientY ?? null;
  }

  function onTouchMove(event: TouchEvent): void {
    const nextY = event.touches[0]?.clientY ?? null;
    if (nextY == null || lastTouchY == null) {
      lastTouchY = nextY;
      return;
    }
    if (nextY > lastTouchY + SCROLL_EPSILON_PX) {
      stop();
      return;
    }
    lastTouchY = nextY;
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button === 0 && isLikelyVerticalScrollbarInput(event, scrollHost)) stop();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (isUpwardScrollKey(event.key)) stop();
  }

  const tick = () => {
    animationFrame = null;
    if (stopped) return;
    if (!scrollHost.isConnected || window.performance.now() - startedAt > durationMs) {
      stop();
      return;
    }

    const currentTop = scrollHost.scrollTop;
    if (currentTop + SCROLL_EPSILON_PX < baselineTop) {
      markProgrammaticScroll();
      suppressScrollRestoreFor(scrollHost, RESTORE_SUPPRESS_MS);
      scrollHost.scrollTop = baselineTop;
    } else if (currentTop > baselineTop) {
      baselineTop = currentTop;
    }

    animationFrame = window.requestAnimationFrame(tick);
  };

  scrollHost.addEventListener("wheel", onWheel, { capture: true, passive: true });
  scrollHost.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
  scrollHost.addEventListener("touchmove", onTouchMove, { capture: true, passive: true });
  scrollHost.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("keydown", onKeyDown, true);
  animationFrame = window.requestAnimationFrame(tick);

  return stop;
}
