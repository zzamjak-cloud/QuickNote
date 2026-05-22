export const BOX_SELECTION_COLORS = {
  marqueeBorder: "rgba(59, 130, 246, 0.9)",
  marqueeFill: "rgba(59, 130, 246, 0.12)",
  selectedFill: "rgba(35, 131, 226, 0.18)",
  selectedRing: "rgba(35, 131, 226, 0.7)",
} as const;

export const BOX_SELECTION_Z_INDEX = {
  selectedOverlay: "720",
  marquee: "730",
} as const;

export function applyBoxMarqueeElementStyle(el: HTMLElement): void {
  el.style.border = `2px dashed ${BOX_SELECTION_COLORS.marqueeBorder}`;
  el.style.background = BOX_SELECTION_COLORS.marqueeFill;
  el.style.borderRadius = "4px";
  el.style.zIndex = BOX_SELECTION_Z_INDEX.marquee;
}
