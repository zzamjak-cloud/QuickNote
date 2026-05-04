import { type RefObject, useEffect } from "react";
import type { Editor } from "@tiptap/react";

export function useBoxSelectEscape(
  editor: Editor | null,
  selectedStartsRef: RefObject<number[]>,
  clearSelection: () => void,
): void {
  useEffect(() => {
    if (!editor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selectedStartsRef.current.length === 0) return;
      clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, selectedStartsRef, clearSelection]);
}
