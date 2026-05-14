import { Extension } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";

const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}", "“": "”" };

export const BracketAutoClose = Extension.create({
  name: "bracketAutoClose",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleTextInput(view, from, to, text) {
            const close = PAIRS[text];
            if (!close) return false;

            const { tr } = view.state;
            if (from !== to) {
              // 선택 영역을 괄호로 감싸기
              tr.insertText(close, to, to);
              tr.insertText(text, from, from);
              tr.setSelection(
                TextSelection.create(tr.doc, from + 1, to + 1),
              );
            } else {
              // 단순 삽입: 커서를 열린 괄호 뒤에 위치
              tr.insertText(text + close, from, to);
              tr.setSelection(TextSelection.create(tr.doc, from + 1));
            }
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});
