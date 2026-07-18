const PUBLIC_OUTLINE_CONTAINER_SELECTOR = ".qn-public-doc .ProseMirror";
const PUBLIC_OUTLINE_TARGET_SELECTOR =
  "h1,h2,h3,h4,summary.toggle-header[data-title-level]";

type PublicOutlineRoot = Document | HTMLElement;

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

export function scrollPublicOutlineTargetIntoView(
  index: number,
  opts: {
    root?: PublicOutlineRoot;
    behavior?: ScrollBehavior;
    topOffset?: number;
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
  return true;
}
