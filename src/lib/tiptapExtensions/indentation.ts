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

function isInsideList($from: ResolvedPos): boolean {
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const typeName = $from.node(depth).type.name;
    if (
      typeName === "listItem" ||
      typeName === "taskItem" ||
      typeName === "bulletList" ||
      typeName === "orderedList" ||
      typeName === "taskList"
    ) {
      return true;
    }
  }
  return false;
}

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
        const { $from } = state.selection;
        const insideList = isInsideList($from);

        // 리스트 아이템 안에 있으면 sink (중첩)
        if (schema.nodes.listItem) {
          if (sinkListItem(schema.nodes.listItem)(state, editor.view.dispatch))
            return true;
        }
        if (schema.nodes.taskItem) {
          if (sinkListItem(schema.nodes.taskItem)(state, editor.view.dispatch))
            return true;
        }
        if (insideList) return false;

        // 그 외 블록: 가장 바깥 들여쓰기 대상의 indent 속성 증가
        return applyIndent(editor, 1);
      },

      "Shift-Tab": ({ editor }) => {
        const { state } = editor;
        const { schema } = state;
        const { $from } = state.selection;
        const insideList = isInsideList($from);

        // 리스트 아이템 안에 있으면 lift (중첩 해제)
        if (schema.nodes.listItem) {
          if (liftListItem(schema.nodes.listItem)(state, editor.view.dispatch))
            return true;
        }
        if (schema.nodes.taskItem) {
          if (liftListItem(schema.nodes.taskItem)(state, editor.view.dispatch))
            return true;
        }
        if (insideList) return false;

        // 그 외 블록: 가장 바깥 들여쓰기 대상의 indent 속성 감소
        return applyIndent(editor, -1);
      },
    };
  },
});
