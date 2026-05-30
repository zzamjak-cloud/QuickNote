import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

function isInsideCodeBlock(view: EditorView, from: number, to = from): boolean {
  let hasCodeBlock = false;
  view.state.doc.nodesBetween(from, to, (node) => {
    if (node.type.name === "codeBlock") {
      hasCodeBlock = true;
      return false;
    }
    return true;
  });
  if (hasCodeBlock) return true;

  const $from = view.state.doc.resolve(from);
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === "codeBlock") return true;
  }
  return false;
}

function applyInlineCodeMark(view: EditorView, from: number, to: number): boolean {
  if (from === to) return false;
  if (isInsideCodeBlock(view, from, to)) return false;
  const codeMark = view.state.schema.marks.code;
  if (!codeMark) return false;
  view.dispatch(view.state.tr.addMark(from, to, codeMark.create()));
  return true;
}

export const InlineCodeShortcut = Extension.create({
  name: "inlineCodeShortcut",

  addKeyboardShortcuts() {
    return {
      // 표준 단축키 Mod+E (Ctrl+E / Cmd+E) → 인라인 코드 토글.
      // 브라우저 기본(예: 일부 브라우저 검색바 포커스)을 막기 위해 명시적으로 등록.
      "Mod-e": () => this.editor.chain().focus().toggleCode().run(),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleTextInput: (view, from, to, text) => {
            if (text !== "`") return false;
            const codeMark = view.state.schema.marks.code;
            if (!codeMark) return false;
            if (from !== to) return applyInlineCodeMark(view, from, to);
            if (isInsideCodeBlock(view, from)) return false;
            const { $from } = view.state.selection;
            const blockStart = $from.start();
            const beforeText = view.state.doc.textBetween(blockStart, from, "\0", "\0");
            const hit = beforeText.match(/`([^`\n]+)$/);
            if (!hit?.[1]) return false;
            const raw = hit[0];
            const inner = hit[1];
            const start = from - raw.length;
            const tr = view.state.tr.insertText(inner, start, from);
            tr.addMark(start, start + inner.length, codeMark.create());
            view.dispatch(tr);
            return true;
          },
          // 선택 영역이 있는 상태에서 백틱을 누르면 선택 영역을 인라인 코드로 토글.
          handleKeyDown: (_view, event) => {
            if (event.key !== "`" || event.metaKey || event.ctrlKey || event.altKey) return false;
            const { state } = this.editor;
            const codeMark = state.schema.marks.code;
            if (!codeMark) return false;
            if (state.selection.empty) {
              const from = state.selection.from;
              if (isInsideCodeBlock(this.editor.view, from)) return false;
              const $from = state.selection.$from;
              const blockStart = $from.start();
              const beforeText = state.doc.textBetween(blockStart, from, "\0", "\0");
              const hit = beforeText.match(/`([^`\n]+)$/);
              if (!hit?.[1]) return false;
              event.preventDefault();
              const raw = hit[0];
              const inner = hit[1];
              const start = from - raw.length;
              const tr = state.tr.insertText(inner, start, from);
              tr.addMark(start, start + inner.length, codeMark.create());
              this.editor.view.dispatch(tr);
              return true;
            }
            const { from, to } = state.selection;
            const applied = applyInlineCodeMark(this.editor.view, from, to);
            if (!applied) return false;
            event.preventDefault();
            return true;
          },
        },
      }),
    ];
  },
});
