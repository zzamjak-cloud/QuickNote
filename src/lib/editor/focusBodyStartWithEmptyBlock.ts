import type { Editor as TiptapEditor } from "@tiptap/core";
import { Selection } from "@tiptap/pm/state";

function firstNodeIsEmptyParagraph(editor: TiptapEditor): boolean {
  const firstNode = editor.state.doc.firstChild;
  const paragraphType = editor.schema.nodes.paragraph;
  return Boolean(
    firstNode &&
      paragraphType &&
      firstNode.type === paragraphType &&
      firstNode.content.size === 0,
  );
}

export function focusBodyStartWithEmptyBlock(
  editor: TiptapEditor | null | undefined,
): boolean {
  if (!editor || editor.isDestroyed) return false;
  if (!editor.isEditable) {
    editor.chain().focus().run();
    return true;
  }

  const paragraphType = editor.schema.nodes.paragraph;
  if (!paragraphType) {
    editor.chain().focus().run();
    return true;
  }

  if (firstNodeIsEmptyParagraph(editor)) {
    editor
      .chain()
      .focus(1)
      .run();
    return true;
  }

  const tr = editor.state.tr.insert(0, paragraphType.create());
  const selection = Selection.near(tr.doc.resolve(1), 1);
  editor.view.dispatch(tr.setSelection(selection).scrollIntoView());
  editor.view.focus();
  return true;
}
