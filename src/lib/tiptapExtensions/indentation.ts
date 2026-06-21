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

        // 리스트 아이템 안에 있으면 lift (중첩 해제)
        if (schema.nodes.listItem) {
          if (liftListItem(schema.nodes.listItem)(state, editor.view.dispatch))
            return true;
        }
        if (schema.nodes.taskItem) {
          if (liftListItem(schema.nodes.taskItem)(state, editor.view.dispatch))
            return true;
        }
        // 더 lift 할 수 없으면: 리스트 컨테이너 indent 속성을 줄인다(root 글머리 대응).
        return applyIndent(editor, -1);
      },
    };
  },
});
