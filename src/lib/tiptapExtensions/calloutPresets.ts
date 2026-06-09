/** 콜아웃 프리셋 — 의미·아이콘·색 매핑 */
export type CalloutPresetId =
  | "none"
  | "empty"
  | "info"
  | "warning"
  | "danger"
  | "idea"
  | "success"
  | "note"
  | "tip"
  // 아이콘 없이 배경색만 적용하는 컬러칩 전용 변형
  | "info-plain"
  | "warning-plain"
  | "danger-plain"
  | "idea-plain"
  | "success-plain"
  | "note-plain"
  | "tip-plain";

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
    label: "프레임",
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
    emoji: "📓",
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

/** 아이콘 없이 배경색만 적용하는 컬러칩 전용 프리셋 */
const COLOR_ONLY_BASES = [
  { id: "info-plain" as const,    src: "info" as const },
  { id: "warning-plain" as const, src: "warning" as const },
  { id: "danger-plain" as const,  src: "danger" as const },
  { id: "idea-plain" as const,    src: "idea" as const },
  { id: "success-plain" as const, src: "success" as const },
  { id: "note-plain" as const,    src: "note" as const },
  { id: "tip-plain" as const,     src: "tip" as const },
];

export const CALLOUT_COLOR_CHIP_PRESETS: CalloutPresetDef[] = COLOR_ONLY_BASES.map(
  ({ id, src }) => {
    const base = CALLOUT_PRESETS.find((p) => p.id === src)!;
    return { ...base, id, emoji: "" };
  },
);

export const CALLOUT_PRESET_MAP = Object.fromEntries(
  [...CALLOUT_PRESETS, ...CALLOUT_COLOR_CHIP_PRESETS].map((p) => [p.id, p]),
) as Record<CalloutPresetId, CalloutPresetDef>;

/**
 * 컬럼 레이아웃 전용 프리셋 목록.
 * - 최상단 "None": 아웃라인까지 완전히 숨김 (CSS [data-preset="none"] 처리)
 * - "empty"는 컬럼에서 아웃라인만 남기므로 라벨을 "프레임"으로 노출
 */
export const COLUMN_LAYOUT_PRESETS: CalloutPresetDef[] = [
  {
    id: "none",
    label: "None",
    hint: "아웃라인 숨김",
    emoji: "",
    color: null,
    frameClass: "border-none bg-transparent shadow-none ring-0",
  },
  ...CALLOUT_PRESETS,
];

const LEGACY_EMOJI_TO_PRESET: Record<string, CalloutPresetId> = {
  "💡": "idea",
  "ℹ️": "info",
  "⚠️": "warning",
  "⛔": "danger",
  "✅": "success",
  "📓": "note",
  "💬": "tip",
};

export function presetFromLegacyEmoji(emoji: string): CalloutPresetId {
  return LEGACY_EMOJI_TO_PRESET[emoji] ?? "idea";
}
