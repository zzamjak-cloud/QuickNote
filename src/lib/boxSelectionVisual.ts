export const BOX_SELECTION_COLORS = {
  marqueeBorder: "rgba(59, 130, 246, 0.9)",
  marqueeFill: "rgba(59, 130, 246, 0.12)",
  selectedFill: "rgba(35, 131, 226, 0.18)",
  selectedRing: "rgba(35, 131, 226, 0.7)",
} as const;

// 선택 표시(fixed 오버레이)는 앱 크롬 아래에 있어야 한다:
// TopBar/TabBar z-[350] · 모바일 드로어 360 · AI 패널 400 · 설정 모달 500.
// 에디터 콘텐츠(스티키 헤더 등 ≤ z-100)보다는 위. 그립 메뉴는 팝업이라 크롬 위 유지.
export const BOX_SELECTION_Z_INDEX = {
  selectedOverlay: "300",
  marquee: "310",
  /** 그립 메뉴·서브메뉴 — 팝업이므로 크롬·마퀴보다 위 */
  blockHandleMenu: "740",
} as const;

export function applyBoxMarqueeElementStyle(el: HTMLElement): void {
  el.style.border = `2px dashed ${BOX_SELECTION_COLORS.marqueeBorder}`;
  el.style.background = BOX_SELECTION_COLORS.marqueeFill;
  el.style.borderRadius = "4px";
  el.style.zIndex = BOX_SELECTION_Z_INDEX.marquee;
}
