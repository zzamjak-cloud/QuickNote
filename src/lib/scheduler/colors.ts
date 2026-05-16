// LC 스케줄러 색상 프리셋 — TeamScheduler 와 동일.
export const COLOR_PRESETS = [
  // 빨강 계열
  "#FF5733", "#E74C3C", "#C0392B", "#FF6B6B",
  // 주황/노랑 계열
  "#F39C12", "#E67E22", "#F1C40F", "#F9A825",
  // 초록 계열
  "#27AE60", "#2ECC71", "#1ABC9C", "#00897B",
  // 파랑 계열
  "#3498DB", "#33C1FF", "#2980B9", "#5C6BC0",
  // 보라/핑크 계열
  "#8E44AD", "#9B59B6", "#AB47BC", "#E91E63",
  // 중성 계열
  "#607D8B", "#795548", "#455A64", "#78909C",
] as const;

export const DEFAULT_SCHEDULE_COLOR = "#3498DB";
export const DEFAULT_WEEKEND_COLOR = "#ffe3de";
export const ANNUAL_LEAVE_COLOR = "#e64c4c";
export const COLLISION_COLOR = "#EF4444";
export const GLOBAL_EVENT_COLOR = "#f59e0b";

// 흰색 텍스트로 충분한 대비를 갖는지 단순 휘도 계산
export function pickTextColor(hex: string): "#ffffff" | "#1a1a1a" {
  const h = hex.replace("#", "");
  if (h.length < 6) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.6 ? "#1a1a1a" : "#ffffff";
}
