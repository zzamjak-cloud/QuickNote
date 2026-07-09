import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { resolveEmojiShortcode } from "../emojiShortcodes";

export { EMOJI_SHORTCODE_ENTRIES, resolveEmojiShortcode } from "../emojiShortcodes";

type EmojiShortcodeMatch = {
  emoji: string;
  keyword: string;
  shortcodeLength: number;
};

// 기호 별칭(예: :! → ❗)도 지원하기 위해 문자 클래스에 ! 를 포함.
const SHORTCODE_PATTERN = /(^|\s):([a-zA-Z가-힣!]+)$/;

export function findEmojiShortcode(textBeforeCursor: string): EmojiShortcodeMatch | null {
  const match = textBeforeCursor.match(SHORTCODE_PATTERN);
  const keyword = match?.[2] ?? "";
  const emoji = resolveEmojiShortcode(keyword);
  if (!emoji) return null;
  return {
    emoji,
    keyword,
    shortcodeLength: keyword.length + 1,
  };
}

function canReplaceInCurrentBlock(view: EditorView, pos: number): boolean {
  const $pos = view.state.doc.resolve(pos);
  if (!$pos.parent.isTextblock) return false;
  return $pos.parent.type.name !== "codeBlock";
}

function replaceShortcodeBeforeSelection(view: EditorView, suffix = ""): boolean {
  const { state } = view;
  if (!state.selection.empty) return false;
  if (!canReplaceInCurrentBlock(view, state.selection.from)) return false;

  const { $from } = state.selection;
  const blockStart = $from.start();
  const textBeforeCursor = state.doc.textBetween(blockStart, state.selection.from, "\0", "\0");
  const hit = findEmojiShortcode(textBeforeCursor);
  if (!hit) return false;

  const from = state.selection.from - hit.shortcodeLength;
  if (from < blockStart) return false;
  view.dispatch(state.tr.insertText(`${hit.emoji}${suffix}`, from, state.selection.from));
  return true;
}

export const EmojiShortcode = Extension.create({
  name: "emojiShortcode",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleTextInput: (view, from, to, text) => {
            if (from !== to) return false;
            if (!canReplaceInCurrentBlock(view, from)) return false;
            if (/^\s+$/.test(text)) {
              return replaceShortcodeBeforeSelection(view, text);
            }
            return false;
          },
          handleKeyDown: (view, event) => {
            if (event.key !== " " && event.key !== "Spacebar") return false;
            if (event.metaKey || event.ctrlKey || event.altKey) return false;
            if (view.composing) return false;
            if (!replaceShortcodeBeforeSelection(view, " ")) return false;
            event.preventDefault();
            return true;
          },
        },
      }),
    ];
  },
});
