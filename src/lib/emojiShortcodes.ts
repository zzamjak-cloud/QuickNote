export type EmojiShortcodeEntry = {
  keyword: string;
  emoji: string;
};

export const EMOJI_SHORTCODE_ENTRIES: EmojiShortcodeEntry[] = [
  { keyword: "체크", emoji: "✅" },
  { keyword: "확인", emoji: "✔️" },
  { keyword: "핀", emoji: "📌" },
  { keyword: "별", emoji: "⭐" },
  { keyword: "하트", emoji: "❤️" },
  { keyword: "불", emoji: "🔥" },
  { keyword: "웃음", emoji: "😊" },
  { keyword: "경고", emoji: "⚠️" },
  { keyword: "정보", emoji: "ℹ️" },
  { keyword: "아이디어", emoji: "💡" },
  { keyword: "메모", emoji: "📝" },
  { keyword: "집", emoji: "🏠" },
  { keyword: "사람", emoji: "👤" },
  { keyword: "손", emoji: "👋" },
  { keyword: "박수", emoji: "👏" },
  { keyword: "엄지", emoji: "👍" },
  { keyword: "금지", emoji: "🚫" },
  { keyword: "질문", emoji: "❓" },
  { keyword: "느낌표", emoji: "❗" },
  { keyword: "시계", emoji: "🕐" },
  { keyword: "달력", emoji: "📅" },
  { keyword: "책", emoji: "📚" },
  { keyword: "링크", emoji: "🔗" },
  { keyword: "잠금", emoji: "🔒" },
  { keyword: "열쇠", emoji: "🔑" },
  { keyword: "검색", emoji: "🔍" },
  { keyword: "설정", emoji: "⚙️" },
  { keyword: "삭제", emoji: "🗑️" },
  { keyword: "복사", emoji: "📋" },
  { keyword: "저장", emoji: "💾" },
  { keyword: "편집", emoji: "✏️" },
  { keyword: "화살표위", emoji: "⬆️" },
  { keyword: "화살표아래", emoji: "⬇️" },
  { keyword: "화살표왼쪽", emoji: "⬅️" },
  { keyword: "화살표오른쪽", emoji: "➡️" },
  { keyword: "check", emoji: "✅" },
  { keyword: "star", emoji: "⭐" },
  { keyword: "heart", emoji: "❤️" },
  { keyword: "fire", emoji: "🔥" },
  { keyword: "warning", emoji: "⚠️" },
  { keyword: "info", emoji: "ℹ️" },
  { keyword: "idea", emoji: "💡" },
  { keyword: "note", emoji: "📝" },
  { keyword: "pin", emoji: "📌" },
  { keyword: "flag", emoji: "🚩" },
];

export type EmojiShortcodeGroup = {
  emoji: string;
  keywords: string[];
  label: string;
};

export const EMOJI_SHORTCODE_GROUPS: EmojiShortcodeGroup[] = Array.from(
  EMOJI_SHORTCODE_ENTRIES.reduce((groups, entry) => {
    const keywords = groups.get(entry.emoji) ?? [];
    keywords.push(entry.keyword);
    groups.set(entry.emoji, keywords);
    return groups;
  }, new Map<string, string[]>()),
  ([emoji, keywords]) => ({
    emoji,
    keywords,
    label: `${emoji} ${keywords.map((keyword) => `:${keyword}`).join(" 또는 ")}`,
  }),
);

const EMOJI_SHORTCODE_MAP = Object.fromEntries(
  EMOJI_SHORTCODE_ENTRIES.map((entry) => [entry.keyword.toLowerCase(), entry.emoji]),
) as Record<string, string>;

export function resolveEmojiShortcode(keyword: string): string | null {
  return EMOJI_SHORTCODE_MAP[keyword.trim().toLowerCase()] ?? null;
}
