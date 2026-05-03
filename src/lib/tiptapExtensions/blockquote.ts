import { Blockquote } from "@tiptap/extension-blockquote";

/** `> ` 단축은 토글 목록(toggle)으로 쓰므로 인용 블록 자동 input rule 은 끈다. */
export const BlockquoteNoInput = Blockquote.extend({
  addInputRules() {
    return [];
  },
});
