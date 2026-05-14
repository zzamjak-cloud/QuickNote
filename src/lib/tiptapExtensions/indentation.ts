import { Extension } from "@tiptap/core";
import { sinkListItem, liftListItem } from "prosemirror-schema-list";

const MAX_INDENT = 6;

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
            renderHTML: (attrs) =>
              (attrs.indent as number) > 0
                ? { "data-indent": String(attrs.indent) }
                : {},
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

        // 그 외 블록: indent 속성 증가
        const { $from } = state.selection;
        const node = $from.depth > 0 ? $from.node(1) : null;
        if (!node) return false;
        const currentIndent = (node.attrs.indent as number) || 0;
        if (currentIndent >= MAX_INDENT) return false;
        return editor.commands.updateAttributes(node.type.name, {
          indent: currentIndent + 1,
        });
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

        // 그 외 블록: indent 속성 감소
        const { $from } = state.selection;
        const node = $from.depth > 0 ? $from.node(1) : null;
        if (!node) return false;
        const currentIndent = (node.attrs.indent as number) || 0;
        if (currentIndent <= 0) return false;
        return editor.commands.updateAttributes(node.type.name, {
          indent: currentIndent - 1,
        });
      },
    };
  },
});
