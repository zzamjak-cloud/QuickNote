import { type RefObject, useEffect } from "react";
import type { Editor } from "@tiptap/react";

/** 박스 선택된 블록 일괄 삭제(삭제 잠금 DB 블록 제외) */
export function useBoxSelectDeleteBlocks(
  editor: Editor | null,
  selectedStartsRef: RefObject<number[]>,
  clearSelection: () => void,
): void {
  useEffect(() => {
    if (!editor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.key === "Process") return;
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      if (selectedStartsRef.current.length === 0) return;
      e.preventDefault();
      e.stopPropagation();

      const doc0 = editor.state.doc;
      const sorted = [...selectedStartsRef.current].sort((a, b) => b - a);
      const tr = editor.state.tr;

      for (const pos of sorted) {
        const node = doc0.nodeAt(pos);
        if (!node) continue;
        if (node.type.name === "databaseBlock" && node.attrs.deletionLocked) {
          continue;
        }
        const mappedPos = tr.mapping.map(pos);
        tr.delete(mappedPos, mappedPos + node.nodeSize);
      }

      if (tr.docChanged) {
        editor.view.dispatch(tr.scrollIntoView());
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editor, selectedStartsRef, clearSelection]);
}
