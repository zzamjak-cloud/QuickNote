import { OrderedList } from "@tiptap/extension-list";
import { wrappingInputRule } from "@tiptap/core";

/** `1. ` / `2. ` 등 숫자+마침표(반각·전각)+공백 입력 시 번호 목록 자동 생성 */
const ORDERED_LIST_MARKDOWN_REGEX = /^\s*(\d+)[.．]\s$/;

export const OrderedListMarkdownShortcut = OrderedList.extend({
  addInputRules() {
    return [
      wrappingInputRule({
        find: ORDERED_LIST_MARKDOWN_REGEX,
        type: this.type,
        getAttributes: (match) => ({ start: Number(match[1]) }),
        joinPredicate: (match, node) =>
          node.childCount + Number(node.attrs.start ?? 1) === Number(match[1]),
      }),
    ];
  },
});
