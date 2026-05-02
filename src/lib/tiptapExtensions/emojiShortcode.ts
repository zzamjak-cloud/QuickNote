import { Extension, InputRule } from "@tiptap/core";

const EMOJI_MAP: Record<string, string> = {
  체크: "✅",
  확인: "✔️",
  별: "⭐",
  하트: "❤️",
  불: "🔥",
  웃음: "😊",
  경고: "⚠️",
  정보: "ℹ️",
  아이디어: "💡",
  메모: "📝",
  집: "🏠",
  사람: "👤",
  손: "👋",
  박수: "👏",
  엄지: "👍",
  금지: "🚫",
  질문: "❓",
  느낌표: "❗",
  시계: "🕐",
  달력: "📅",
  책: "📚",
  링크: "🔗",
  잠금: "🔒",
  열쇠: "🔑",
  검색: "🔍",
  설정: "⚙️",
  삭제: "🗑️",
  복사: "📋",
  저장: "💾",
  편집: "✏️",
  화살표위: "⬆️",
  화살표아래: "⬇️",
  화살표왼쪽: "⬅️",
  화살표오른쪽: "➡️",
  check: "✅",
  star: "⭐",
  heart: "❤️",
  fire: "🔥",
  warning: "⚠️",
  info: "ℹ️",
  idea: "💡",
  note: "📝",
  pin: "📌",
  flag: "🚩",
};

export const EmojiShortcode = Extension.create({
  name: "emojiShortcode",

  addInputRules() {
    return [
      new InputRule({
        find: /:([a-zA-Z가-힣]+):$/,
        handler: ({ chain, range, match }) => {
          const keyword = (match[1] ?? "").toLowerCase();
          const emoji = EMOJI_MAP[keyword];
          if (!emoji) return null;
          chain().deleteRange(range).insertContent(emoji).run();
        },
      }),
    ];
  },
});
