import { type RefObject, useEffect } from "react";
import type { Editor } from "@tiptap/react";

/** 박스 선택된 블록 일괄 복제 — Ctrl/Cmd+D 가 브라우저 북마크로 가지 않도록 capture 에서 차단 */
export function useBoxSelectDuplicateBlocks(
  editor: Editor | null,
  selectedStartsRef: RefObject<number[]>,
): void {
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.key === "Process") return;
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "d") return;
      if (selectedStartsRef.current.length === 0) return;
      e.preventDefault();
      e.stopPropagation();

      const doc0 = editor.state.doc;
      const sorted = [...selectedStartsRef.current].sort((a, b) => b - a);
      const tr = editor.state.tr;

      for (const pos of sorted) {
        const node = doc0.nodeAt(pos);
        if (!node) continue;
        const mappedPos = tr.mapping.map(pos);
        tr.insert(mappedPos + node.nodeSize, node.copy(node.content));
      }

      if (tr.docChanged) {
        editor.view.dispatch(tr.scrollIntoView());
        editor.view.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editor, selectedStartsRef]);
}
