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
  frameClass: string;
};

/** Tailwind 클래스 문자열 — 한 줄로 유지 (동적 조합) */
export const CALLOUT_PRESETS: CalloutPresetDef[] = [
  {
    id: "empty",
    label: "Empty",
    hint: "아이콘·배경 없음, 회색 테두리만",
    emoji: "",
    frameClass:
      "border border-zinc-300 bg-transparent shadow-none ring-0 dark:border-zinc-600",
  },
  {
    id: "info",
    label: "정보",
    hint: "안내·참고",
    emoji: "ℹ️",
    frameClass:
      "border border-sky-200/95 bg-sky-50/95 shadow-sm ring-1 ring-sky-100/90 dark:border-sky-800/70 dark:bg-sky-950/40 dark:ring-sky-900/45",
  },
  {
    id: "warning",
    label: "경고",
    hint: "주의 필요",
    emoji: "⚠️",
    frameClass:
      "border border-amber-200/95 bg-amber-50/95 shadow-sm ring-1 ring-amber-100/85 dark:border-amber-800/65 dark:bg-amber-950/40 dark:ring-amber-900/45",
  },
  {
    id: "danger",
    label: "위험",
    hint: "중요 경고·금지",
    emoji: "⛔",
    frameClass:
      "border border-red-200/95 bg-red-50/95 shadow-sm ring-1 ring-red-100/85 dark:border-red-900/65 dark:bg-red-950/45 dark:ring-red-900/50",
  },
  {
    id: "idea",
    label: "아이디어",
    hint: "제안·영감 (노랑)",
    emoji: "💡",
    frameClass:
      "border border-yellow-300/90 bg-yellow-50/95 shadow-sm ring-1 ring-yellow-100/85 dark:border-yellow-700/55 dark:bg-yellow-950/35 dark:ring-yellow-900/40",
  },
  {
    id: "success",
    label: "완료·성공",
    hint: "확인·긍정",
    emoji: "✅",
    frameClass:
      "border border-emerald-200/95 bg-emerald-50/95 shadow-sm ring-1 ring-emerald-100/85 dark:border-emerald-800/65 dark:bg-emerald-950/40 dark:ring-emerald-900/45",
  },
  {
    id: "note",
    label: "노트",
    hint: "메모·기록",
    emoji: "📝",
    frameClass:
      "border border-violet-200/95 bg-violet-50/95 shadow-sm ring-1 ring-violet-100/85 dark:border-violet-800/65 dark:bg-violet-950/40 dark:ring-violet-900/45",
  },
  {
    id: "tip",
    label: "팁",
    hint: "짧은 팁",
    emoji: "💬",
    frameClass:
      "border border-indigo-200/95 bg-indigo-50/95 shadow-sm ring-1 ring-indigo-100/85 dark:border-indigo-800/65 dark:bg-indigo-950/40 dark:ring-indigo-900/45",
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
