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
const SCROLLBAR_HIT_SLOP_PX = 48;
const RESTORE_SCROLL_EPSILON_PX = 2;
const RESTORE_LAYOUT_CHANGE_GRACE_MS = 120;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

const makeKey = (scope: PageScrollScope, pageId: string): string => `${scope}:${pageId}`;

const markUserScrollInput = (): void => {
  lastUserScrollInputAt = window.performance.now();
};

export function isLikelyVerticalScrollbarInput(
  event: Pick<MouseEvent, "clientX" | "clientY">,
  scroller: HTMLElement,
): boolean {
  if (scroller.scrollHeight <= scroller.clientHeight) return false;
  const rect = scroller.getBoundingClientRect();
  const nativeScrollbarWidth = Math.max(0, scroller.offsetWidth - scroller.clientWidth);
  const hitWidth = Math.max(SCROLLBAR_HIT_SLOP_PX, nativeScrollbarWidth);
  return (
    event.clientX >= rect.right - hitWidth &&
    event.clientX <= rect.right + 2 &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  );
}

function scrollContainerFromEventTarget(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element
    ? target.closest<HTMLElement>("[data-qn-scroll-page-id]")
    : null;
}

/**
 * 프로그래밍적 스크롤(블록 링크·댓글·검색 결과 이동)이 발생했음을 알린다.
 * 진행 중인 스크롤 위치 복원이 우리 스크롤을 즉시 되돌리지 못하도록,
 * "사용자가 스크롤을 가로챘다"와 동일하게 취급해 복원 루프를 종료시킨다.
 */
export const markProgrammaticScroll = (): void => {
  lastUserScrollInputAt = window.performance.now();
};

// 특정 스크롤러에 대해 위치 복원을 일정 시간 억제한다(블록 링크 이동 등).
// startedAt 비교 기반 양보(userTookOver)는 복원이 우리 스크롤보다 늦게 시작되면 실패하므로,
// 복원의 RAF/MutationObserver 수명(최대 3s)을 덮는 시간 동안 해당 스크롤러의 복원을 강제 종료시킨다.
const suppressRestoreUntilByScroller = new WeakMap<HTMLElement, number>();

export const suppressScrollRestoreFor = (
  scroller: HTMLElement | null | undefined,
  durationMs = 3500,
): void => {
  if (!scroller) return;
  const until = window.performance.now() + durationMs;
  const prev = suppressRestoreUntilByScroller.get(scroller) ?? 0;
  suppressRestoreUntilByScroller.set(scroller, Math.max(prev, until));
};

const isScrollRestoreSuppressedFor = (scroller: HTMLElement): boolean =>
  window.performance.now() < (suppressRestoreUntilByScroller.get(scroller) ?? 0);

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
  const onPotentialScrollbarInput = (event: MouseEvent | PointerEvent) => {
    if (event.button !== 0) return;
    const container = scrollContainerFromEventTarget(event.target);
    if (!container || !isLikelyVerticalScrollbarInput(event, container)) return;
    markUserScrollInput();
    suppressScrollRestoreFor(container);
  };
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
  document.addEventListener("pointerdown", onPotentialScrollbarInput, true);
  document.addEventListener("mousedown", onPotentialScrollbarInput, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("scroll", onScroll, true);
  return () => {
    document.removeEventListener("wheel", onWheel, true);
    document.removeEventListener("touchmove", onTouchMove, true);
    document.removeEventListener("pointerdown", onPotentialScrollbarInput, true);
    document.removeEventListener("mousedown", onPotentialScrollbarInput, true);
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
  const savedEntry = scrollByKey.get(key);
  // 저장된 스크롤 위치가 없거나 맨 위면 복원할 것이 없다. 이때 0(시작 지점)으로 강제 고정하면
  // 블록 링크·댓글·검색 결과 등 프로그래밍적 이동을 덮어쓰므로 복원 루프를 아예 시작하지 않는다.
  if (!savedEntry || (savedEntry.top <= 0 && savedEntry.left <= 0)) {
    return undefined;
  }
  const saved = savedEntry;
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
  let lastAppliedTop: number | null = null;
  let lastAppliedLeft: number | null = null;
  let layoutChangeGraceUntil = 0;

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
    scroller.removeEventListener("scroll", onRestoringScroll);
    restoringByScroller.delete(scroller);
  };

  // 복원 시작 이후 사용자가 직접 스크롤(wheel/touch/key)했는지.
  const userTookOver = (): boolean => lastUserScrollInputAt > startedAt;

  const apply = () => {
    if (cancelled || finished) return;
    if (userTookOver() || isScrollRestoreSuppressedFor(scroller)) {
      finish();
      return;
    }
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const maxLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const targetTop = clamp(saved.top, 0, maxTop);
    const targetLeft = clamp(saved.left, 0, maxLeft);
    lastAppliedTop = targetTop;
    lastAppliedLeft = targetLeft;
    scroller.scrollTop = targetTop;
    scroller.scrollLeft = targetLeft;
  };

  const onRestoringScroll = () => {
    if (cancelled || finished) return;
    if (userTookOver() || isScrollRestoreSuppressedFor(scroller)) {
      finish();
      return;
    }
    if (lastAppliedTop == null || lastAppliedLeft == null) return;
    if (window.performance.now() < layoutChangeGraceUntil) return;
    const movedAwayFromRestoreTarget =
      Math.abs(scroller.scrollTop - lastAppliedTop) > RESTORE_SCROLL_EPSILON_PX ||
      Math.abs(scroller.scrollLeft - lastAppliedLeft) > RESTORE_SCROLL_EPSILON_PX;
    if (!movedAwayFromRestoreTarget) return;
    markUserScrollInput();
    suppressScrollRestoreFor(scroller);
    finish();
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
  const applyAfterLayoutChange = () => {
    layoutChangeGraceUntil = window.performance.now() + RESTORE_LAYOUT_CHANGE_GRACE_MS;
    apply();
  };

  scroller.addEventListener("scroll", onRestoringScroll, { passive: true });
  resizeObserver = new ResizeObserver(applyAfterLayoutChange);
  resizeObserver.observe(scroller);
  mutationObserver = new MutationObserver(applyAfterLayoutChange);
  mutationObserver.observe(scroller, { childList: true, subtree: true });
  timeoutId = window.setTimeout(() => finish(), timeoutMs);
  apply();
  frameId = window.requestAnimationFrame(rafTick);

  return () => {
    cancelled = true;
    finish();
  };
}
