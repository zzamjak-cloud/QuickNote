// 블록 핸들 메뉴에서 마지막으로 사용한 텍스트 컬러·배경 컬러를 기억한다(localStorage).
import type { BlockBgColor, BlockTextColor } from "../tiptapExtensions/blockBackground";

const LS_KEY = "qn.recentBlockColors.v1";

export type RecentBlockColors = {
  text: Exclude<BlockTextColor, null> | null;
  bg: Exclude<BlockBgColor, null> | null;
};

export function getRecentBlockColors(): RecentBlockColors {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { text: null, bg: null };
    const parsed = JSON.parse(raw) as Partial<RecentBlockColors>;
    return {
      text: typeof parsed?.text === "string" ? parsed.text : null,
      bg: typeof parsed?.bg === "string" ? parsed.bg : null,
    };
  } catch {
    return { text: null, bg: null };
  }
}

export function setRecentTextColor(id: Exclude<BlockTextColor, null>): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ...getRecentBlockColors(), text: id }));
  } catch {
    /* noop */
  }
}

export function setRecentBgColor(id: Exclude<BlockBgColor, null>): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ...getRecentBlockColors(), bg: id }));
  } catch {
    /* noop */
  }
}
