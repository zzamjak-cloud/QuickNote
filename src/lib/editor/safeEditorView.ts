import type { Editor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";

/** TipTap EditorView 는 마운트 전 접근 시 throw 하므로 DOM 접근 전에 안전하게 확인한다. */
export function getMountedEditorView(editor: Editor | null | undefined): EditorView | null {
  if (!editor || editor.isDestroyed) return null;
  try {
    return editor.view;
  } catch {
    return null;
  }
}
