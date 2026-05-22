// Notion HTML 색상 매핑 + 파서. htmlToDoc 에서 분리 — 순수 함수.

export const CLASS_COLOR_MAP: Record<string, { css: string; token: string }> = {
  "highlight-default": { css: "#2c2c2b", token: "default" },
  "highlight-teal": { css: "#0f766e", token: "teal" },
  "highlight-blue": { css: "#2563eb", token: "blue" },
  "highlight-red": { css: "#e11d48", token: "red" },
  "highlight-green": { css: "#16a34a", token: "green" },
  "highlight-orange": { css: "#ea580c", token: "orange" },
  "highlight-yellow": { css: "#ca8a04", token: "yellow" },
  "highlight-purple": { css: "#9333ea", token: "purple" },
  "highlight-pink": { css: "#db2777", token: "pink" },
  "highlight-gray": { css: "#6b7280", token: "gray" },
  "block-color-default": { css: "#2c2c2b", token: "default" },
  "block-color-teal": { css: "#0f766e", token: "teal" },
  "block-color-blue": { css: "#2563eb", token: "blue" },
  "block-color-red": { css: "#e11d48", token: "red" },
  "block-color-green": { css: "#16a34a", token: "green" },
  "block-color-orange": { css: "#ea580c", token: "orange" },
  "block-color-yellow": { css: "#ca8a04", token: "yellow" },
  "block-color-purple": { css: "#9333ea", token: "purple" },
  "block-color-pink": { css: "#db2777", token: "pink" },
  "block-color-gray": { css: "#6b7280", token: "gray" },
};

export const HIGHLIGHT_BG_COLOR_MAP: Record<string, string> = {
  "highlight-default_background": "#f3f4f6",
  "highlight-gray_background": "#e5e7eb",
  "highlight-brown_background": "#fed7aa",
  "highlight-orange_background": "#fdba74",
  "highlight-yellow_background": "#fde047",
  "highlight-teal_background": "#5eead4",
  "highlight-blue_background": "#93c5fd",
  "highlight-purple_background": "#c4b5fd",
  "highlight-pink_background": "#f9a8d4",
  "highlight-red_background": "#fca5a5",
};

export function parseColorFromStyle(styleValue: string | null): string | null {
  if (!styleValue) return null;
  const m = styleValue.match(/color\s*:\s*([^;]+)/i);
  return m?.[1]?.trim() ?? null;
}

export function parseColorFromClass(
  className: string,
): { css: string; token: string } | null {
  const names = className.split(/\s+/).filter(Boolean);
  for (const name of names) {
    if (CLASS_COLOR_MAP[name]) return CLASS_COLOR_MAP[name];
  }
  return null;
}
