/** 콜아웃 프리셋 — 의미·아이콘·색 매핑 */
export type CalloutPresetId =
  | "empty"
  | "info"
  | "warning"
  | "danger"
  | "idea"
  | "success"
  | "note"
  | "tip";

export type CalloutPresetDef = {
  id: CalloutPresetId;
  label: string;
  hint: string;
  emoji: string;
  color: string | null;
  frameClass: string;
};

/** Tailwind 클래스 문자열 — 한 줄로 유지 (동적 조합) */
export const CALLOUT_PRESETS: CalloutPresetDef[] = [
  {
    id: "empty",
    label: "Empty",
    hint: "아이콘·배경 없음, 회색 테두리만",
    emoji: "",
    color: null,
    frameClass:
      "border border-zinc-300 bg-transparent shadow-none ring-0 dark:border-zinc-600",
  },
  {
    id: "info",
    label: "정보",
    hint: "안내·참고",
    emoji: "ℹ️",
    color: "#e0eefd",
    frameClass: "border bg-[#e0eefd] shadow-none ring-0",
  },
  {
    id: "warning",
    label: "경고",
    hint: "주의 필요",
    emoji: "⚠️",
    color: "#fff6d1",
    frameClass: "border bg-[#fff6d1] shadow-none ring-0",
  },
  {
    id: "danger",
    label: "위험",
    hint: "중요 경고·금지",
    emoji: "⛔",
    color: "#fbe2e2",
    frameClass: "border bg-[#fbe2e2] shadow-none ring-0",
  },
  {
    id: "idea",
    label: "아이디어",
    hint: "제안·영감",
    emoji: "💡",
    color: "#dde1fe",
    frameClass: "border bg-[#dde1fe] shadow-none ring-0",
  },
  {
    id: "success",
    label: "완료·성공",
    hint: "확인·긍정",
    emoji: "✅",
    color: "#e1f8e4",
    frameClass: "border bg-[#e1f8e4] shadow-none ring-0",
  },
  {
    id: "note",
    label: "노트",
    hint: "메모·기록",
    emoji: "📝",
    color: "#eeeaf9",
    frameClass: "border bg-[#eeeaf9] shadow-none ring-0",
  },
  {
    id: "tip",
    label: "팁",
    hint: "짧은 팁",
    emoji: "💬",
    color: "#eef2ff",
    frameClass: "border bg-indigo-50/95 shadow-none ring-0",
  },
];

export const CALLOUT_PRESET_MAP = Object.fromEntries(
  CALLOUT_PRESETS.map((p) => [p.id, p]),
) as Record<CalloutPresetId, CalloutPresetDef>;

const LEGACY_EMOJI_TO_PRESET: Record<string, CalloutPresetId> = {
  "💡": "idea",
  "ℹ️": "info",
  "⚠️": "warning",
  "⛔": "danger",
  "✅": "success",
  "📝": "note",
  "💬": "tip",
};

export function presetFromLegacyEmoji(emoji: string): CalloutPresetId {
  return LEGACY_EMOJI_TO_PRESET[emoji] ?? "idea";
}
