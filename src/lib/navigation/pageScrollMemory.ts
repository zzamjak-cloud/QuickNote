type ScrollSnapshot = {
  left: number;
  top: number;
};

export type PageScrollScope = "main" | "db-row" | "peek";

const STORAGE_KEY = "quicknote.pageScrollMemory.v1";
const DEFAULT_SCOPE: PageScrollScope = "main";
const scrollByKey = new Map<string, ScrollSnapshot>();
const activeBindings = new Set<{ pageId: string; scope: PageScrollScope; scroller: HTMLElement }>();
const restoringByScroller = new WeakMap<
  HTMLElement,
  { key: string; target: ScrollSnapshot; until: number }
>();
let captureInstalled = false;
let lastUserScrollInputAt = 0;
const USER_SCROLL_INPUT_WINDOW_MS = 900;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

const makeKey = (scope: PageScrollScope, pageId: string): string => `${scope}:${pageId}`;

const markUserScrollInput = (): void => {
  lastUserScrollInputAt = window.performance.now();
};

const hasRecentUserScrollInput = (): boolean =>
  window.performance.now() - lastUserScrollInputAt < USER_SCROLL_INPUT_WINDOW_MS;

const readDatasetScope = (value: string | undefined): PageScrollScope =>
  value === "db-row" || value === "peek" ? value : DEFAULT_SCOPE;

const persist = (): void => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(scrollByKey.entries())));
  } catch {
    // sessionStorage 사용 불가 환경에서는 메모리 저장만 유지한다.
  }
};

const hydrate = (): void => {
  if (scrollByKey.size > 0) return;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw) as Array<[string, ScrollSnapshot]>;
    entries.forEach(([key, snapshot]) => {
      if (!snapshot || typeof snapshot.top !== "number" || typeof snapshot.left !== "number") return;
      scrollByKey.set(key, snapshot);
    });
  } catch {
    scrollByKey.clear();
  }
};

export function savePageScrollPosition(
  pageId: string | null | undefined,
  scroller: HTMLElement | null | undefined,
  scope: PageScrollScope = DEFAULT_SCOPE,
  options: { force?: boolean } = {},
): void {
  if (!pageId || !scroller) return;
  hydrate();
  const key = makeKey(scope, pageId);
  const restoring = restoringByScroller.get(scroller);
  if (
    restoring?.key === key &&
    window.performance.now() < restoring.until &&
    (scroller.scrollTop < restoring.target.top || scroller.scrollLeft < restoring.target.left)
  ) {
    return;
  }
  const existing = scrollByKey.get(key);
  const nextTop = Math.max(0, scroller.scrollTop);
  if (
    !options.force &&
    existing &&
    existing.top > 1 &&
    nextTop <= 1 &&
    !hasRecentUserScrollInput()
  ) {
    return;
  }
  scrollByKey.set(makeKey(scope, pageId), {
    left: Math.max(0, scroller.scrollLeft),
    top: nextTop,
  });
  persist();
}

export function bindPageScrollMemory(
  pageId: string | null | undefined,
  scroller: HTMLElement | null | undefined,
  scope: PageScrollScope = DEFAULT_SCOPE,
): (() => void) | undefined {
  if (!pageId || !scroller) return undefined;
  const binding = { pageId, scope, scroller };
  activeBindings.add(binding);
  const onScroll = () => savePageScrollPosition(pageId, scroller, scope);
  scroller.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    scroller.removeEventListener("scroll", onScroll);
    activeBindings.delete(binding);
  };
}

export function flushPageScrollMemory(): void {
  activeBindings.forEach(({ pageId, scope, scroller }) => {
    savePageScrollPosition(pageId, scroller, scope, { force: true });
  });
}

export function installPageScrollCapture(): (() => void) | undefined {
  if (captureInstalled || typeof document === "undefined") return undefined;
  captureInstalled = true;
  const onWheel = () => markUserScrollInput();
  const onTouchMove = () => markUserScrollInput();
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "PageDown" ||
      event.key === "PageUp" ||
      event.key === "Home" ||
      event.key === "End" ||
      event.key === " "
    ) {
      markUserScrollInput();
    }
  };
  const onScroll = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const container = target.closest<HTMLElement>("[data-qn-scroll-page-id]");
    if (!container || container !== target) return;
    savePageScrollPosition(
      container.dataset.qnScrollPageId,
      container,
      readDatasetScope(container.dataset.qnScrollScope),
    );
  };
  document.addEventListener("wheel", onWheel, true);
  document.addEventListener("touchmove", onTouchMove, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("scroll", onScroll, true);
  return () => {
    document.removeEventListener("wheel", onWheel, true);
    document.removeEventListener("touchmove", onTouchMove, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("scroll", onScroll, true);
    captureInstalled = false;
  };
}

export function restorePageScrollPosition(
  pageId: string | null | undefined,
  scroller: HTMLElement | null | undefined,
  scope: PageScrollScope = DEFAULT_SCOPE,
  timeoutMs = 3000,
): (() => void) | undefined {
  if (!pageId || !scroller) return undefined;
  hydrate();
  const key = makeKey(scope, pageId);
  const saved = scrollByKey.get(key) ?? { left: 0, top: 0 };
  restoringByScroller.set(scroller, {
    key,
    target: saved,
    until: window.performance.now() + timeoutMs,
  });
  let frameId: number | null = null;
  let timeoutId: number | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  const startedAt = window.performance.now();
  let cancelled = false;
  let finished = false;

  // RAF 강제 적용은 초반 일정 시간만 한다. (스크롤바 드래그 같은
  // wheel/touch/key 로 감지되지 않는 사용자 조작을 오래 방해하지 않기 위함.)
  const RAF_FORCE_WINDOW_MS = Math.min(1500, timeoutMs);

  const finish = () => {
    if (finished) return;
    finished = true;
    if (frameId != null) window.cancelAnimationFrame(frameId);
    if (timeoutId != null) window.clearTimeout(timeoutId);
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    restoringByScroller.delete(scroller);
  };

  // 복원 시작 이후 사용자가 직접 스크롤(wheel/touch/key)했는지.
  const userTookOver = (): boolean => lastUserScrollInputAt > startedAt;

  const apply = () => {
    if (cancelled || finished) return;
    if (userTookOver()) {
      finish();
      return;
    }
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const maxLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    scroller.scrollTop = clamp(saved.top, 0, maxTop);
    scroller.scrollLeft = clamp(saved.left, 0, maxLeft);
  };

  // 초반 RAF 루프: 비동기 콘텐츠 로드로 높이가 늘어나기 전까지 목표 위치를 계속 적용.
  // 목표에 도달해도 즉시 종료하지 않는다. (페이지 전환 시 이전 콘텐츠가 남아있어
  // 곧바로 도달 판정 → 옵저버 해제 → 직후 비동기 콘텐츠 교체로 스크롤이 초기화되던 회귀 방지.)
  const rafTick = () => {
    if (cancelled || finished) return;
    apply();
    if (finished) return;
    if (window.performance.now() - startedAt < RAF_FORCE_WINDOW_MS) {
      frameId = window.requestAnimationFrame(rafTick);
    } else {
      frameId = null;
    }
  };

  // 콘텐츠 교체/높이 변화는 MutationObserver 로 끝까지 감시하며 재적용한다.
  // 메인 에디터의 본문 교체(replaceWith)가 RAF 종료 후에 일어나도 여기서 다시 복원된다.
  resizeObserver = new ResizeObserver(() => apply());
  resizeObserver.observe(scroller);
  mutationObserver = new MutationObserver(() => apply());
  mutationObserver.observe(scroller, { childList: true, subtree: true });
  timeoutId = window.setTimeout(() => finish(), timeoutMs);
  apply();
  frameId = window.requestAnimationFrame(rafTick);

  return () => {
    cancelled = true;
    finish();
  };
}
