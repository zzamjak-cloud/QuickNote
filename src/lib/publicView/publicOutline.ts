const PUBLIC_OUTLINE_CONTAINER_SELECTOR = ".qn-public-doc .ProseMirror";
const PUBLIC_OUTLINE_TARGET_SELECTOR =
  "h1,h2,h3,h4,summary.toggle-header[data-title-level]";
export const PUBLIC_OUTLINE_FOCUS_CLASS = "qn-public-outline-focus";
const PUBLIC_OUTLINE_FOCUS_MS = 1600;

type PublicOutlineRoot = Document | HTMLElement;
let focusedTarget: HTMLElement | null = null;
let focusTimer: number | null = null;

function isSupportedToggleHeading(el: HTMLElement): boolean {
  if (el.tagName !== "SUMMARY") return true;
  const raw = Number(el.getAttribute("data-title-level"));
  if (!Number.isFinite(raw)) return false;
  const level = Math.floor(raw);
  return level >= 1 && level <= 4;
}

/** 공개 뷰어 DOM에서 목차 항목과 같은 순서의 실제 스크롤 대상 요소를 찾는다. */
export function findPublicOutlineTargets(
  root: PublicOutlineRoot = document,
): HTMLElement[] {
  const container =
    root.querySelector<HTMLElement>(PUBLIC_OUTLINE_CONTAINER_SELECTOR) ??
    root.querySelector<HTMLElement>(".qn-public-doc") ??
    root;
  return Array.from(
    container.querySelectorAll<HTMLElement>(PUBLIC_OUTLINE_TARGET_SELECTOR),
  ).filter(isSupportedToggleHeading);
}

function flashPublicOutlineTarget(target: HTMLElement): void {
  if (focusedTarget && focusedTarget !== target) {
    focusedTarget.classList.remove(PUBLIC_OUTLINE_FOCUS_CLASS);
  }
  if (focusTimer !== null) {
    window.clearTimeout(focusTimer);
  }
  focusedTarget = target;
  target.classList.remove(PUBLIC_OUTLINE_FOCUS_CLASS);
  // 같은 목차 항목을 연속 클릭해도 CSS 애니메이션이 다시 시작되도록 reflow 를 강제한다.
  void target.offsetWidth;
  target.classList.add(PUBLIC_OUTLINE_FOCUS_CLASS);
  focusTimer = window.setTimeout(() => {
    target.classList.remove(PUBLIC_OUTLINE_FOCUS_CLASS);
    if (focusedTarget === target) focusedTarget = null;
    focusTimer = null;
  }, PUBLIC_OUTLINE_FOCUS_MS);
}

export function scrollPublicOutlineTargetIntoView(
  index: number,
  opts: {
    root?: PublicOutlineRoot;
    behavior?: ScrollBehavior;
    topOffset?: number;
    flash?: boolean;
  } = {},
): boolean {
  if (!Number.isInteger(index) || index < 0) return false;
  const target = findPublicOutlineTargets(opts.root)[index];
  if (!target) return false;

  const topOffset = opts.topOffset ?? 72;
  const rect = target.getBoundingClientRect();
  const currentTop =
    window.scrollY ||
    (document.scrollingElement as HTMLElement | null)?.scrollTop ||
    document.documentElement.scrollTop ||
    0;
  window.scrollTo({
    top: Math.max(0, currentTop + rect.top - topOffset),
    behavior: opts.behavior ?? "smooth",
  });
  if (opts.flash) {
    flashPublicOutlineTarget(target);
  }
  return true;
}
