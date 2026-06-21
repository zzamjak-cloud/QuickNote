import { Extension } from "@tiptap/core";
import { sinkListItem, liftListItem } from "prosemirror-schema-list";
import type { Editor } from "@tiptap/core";
import type { ResolvedPos } from "@tiptap/pm/model";

const MAX_INDENT = 6;
const INDENTABLE_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "toggle",
  "blockquote",
  "callout",
]);

function findIndentTarget($from: ResolvedPos) {
  for (let depth = 1; depth <= $from.depth; depth += 1) {
    const node = $from.node(depth);
    if (!INDENTABLE_TYPES.has(node.type.name)) continue;
    return { node, pos: $from.before(depth) };
  }
  return null;
}

function applyIndent(editor: Editor, delta: 1 | -1): boolean {
  const { state } = editor;
  const target = findIndentTarget(state.selection.$from);
  if (!target) return false;
  const currentIndent = (target.node.attrs.indent as number) || 0;
  const nextIndent = currentIndent + delta;
  if (nextIndent < 0 || nextIndent > MAX_INDENT) return false;
  editor.view.dispatch(
    state.tr.setNodeMarkup(target.pos, undefined, {
      ...target.node.attrs,
      indent: nextIndent,
    }, target.node.marks),
  );
  return true;
}

export const Indentation = Extension.create({
  name: "indentation",

  addGlobalAttributes() {
    return [
      {
        types: [
          "paragraph",
          "heading",
          "bulletList",
          "orderedList",
          "taskList",
          "toggle",
          "blockquote",
          "callout",
        ],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) =>
              parseInt(el.getAttribute("data-indent") ?? "0", 10) || 0,
            renderHTML: (attrs) => {
              const indent = typeof attrs.indent === "number" ? attrs.indent : 0;
              return indent > 0 ? { "data-indent": String(indent) } : {};
            },
          },
        },
      },
    ];
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        const { state } = editor;
        const { schema } = state;

        // 리스트 아이템 안에 있으면 sink (중첩)
        if (schema.nodes.listItem) {
          if (sinkListItem(schema.nodes.listItem)(state, editor.view.dispatch))
            return true;
        }
        if (schema.nodes.taskItem) {
          if (sinkListItem(schema.nodes.taskItem)(state, editor.view.dispatch))
            return true;
        }
        // 리스트 첫 항목 등 sink 불가(앞 형제 없음) 시: 리스트 컨테이너 indent
        // 속성으로 들여쓰기한다(root 글머리도 들여쓰기 가능).
        return applyIndent(editor, 1);
      },

      "Shift-Tab": ({ editor }) => {
        const { state } = editor;
        const { schema } = state;

        // Tab 폴백으로 리스트 컨테이너에 적용된 indent 속성이 있으면 먼저 줄인다.
        // liftListItem 보다 우선해야 root 항목이 통째로 리스트에서 빠져
        // 일반 텍스트(글머리·체크박스 소실)가 되는 것을 막는다.
        const target = findIndentTarget(state.selection.$from);
        if (target && ((target.node.attrs.indent as number) || 0) > 0) {
          return applyIndent(editor, -1);
        }

        // 리스트 아이템 안에 있으면 lift (중첩 해제)
        if (schema.nodes.listItem) {
          if (liftListItem(schema.nodes.listItem)(state, editor.view.dispatch))
            return true;
        }
        if (schema.nodes.taskItem) {
          if (liftListItem(schema.nodes.taskItem)(state, editor.view.dispatch))
            return true;
        }
        return applyIndent(editor, -1);
      },
    };
  },
});
