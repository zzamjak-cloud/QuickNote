import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

export const InlineCodeShortcut = Extension.create({
  name: "inlineCodeShortcut",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleKeyDown: (_view, event) => {
            if (event.key !== "`" || event.metaKey || event.ctrlKey || event.altKey) return false;
            const { state } = this.editor;
            if (state.selection.empty) return false;
            const { $from } = state.selection;
            for (let depth = $from.depth; depth > 0; depth -= 1) {
              if ($from.node(depth).type.name === "codeBlock") return false;
            }
            event.preventDefault();
            return this.editor.chain().focus().toggleCode().run();
          },
        },
      }),
    ];
  },
});
