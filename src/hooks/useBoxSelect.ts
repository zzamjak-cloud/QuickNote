import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";

type Rect = { x: number; y: number; w: number; h: number };

export function useBoxSelect(editor: Editor | null) {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [dragRect, setDragRect] = useState<Rect | null>(null);
  const [selectedStarts, setSelectedStarts] = useState<number[]>([]);
  const activeRef = useRef(false);

  const clearSelection = useCallback(() => {
    setSelectedStarts([]);
    document
      .querySelectorAll(".block-selected")
      .forEach((el) => el.classList.remove("block-selected"));
  }, []);

  const getTopLevelBlocks = useCallback((): { el: HTMLElement; pos: number }[] => {
    if (!editor) return [];
    const result: { el: HTMLElement; pos: number }[] = [];
    for (const child of Array.from(editor.view.dom.children)) {
      if (!(child instanceof HTMLElement)) continue;
      try {
        const innerPos = editor.view.posAtDOM(child, 0);
        const blockStart = innerPos - 1;
        if (blockStart >= 0) result.push({ el: child, pos: blockStart });
      } catch {}
    }
    return result;
  }, [editor]);

  const updateSelection = useCallback(
    (rect: Rect) => {
      const blocks = getTopLevelBlocks();
      const newStarts: number[] = [];
      blocks.forEach(({ el, pos }) => {
        const br = el.getBoundingClientRect();
        const intersects =
          br.left < rect.x + rect.w &&
          br.right > rect.x &&
          br.top < rect.y + rect.h &&
          br.bottom > rect.y;
        if (intersects) {
          el.classList.add("block-selected");
          newStarts.push(pos);
        } else {
          el.classList.remove("block-selected");
        }
      });
      setSelectedStarts(newStarts);
    },
    [getTopLevelBlocks],
  );

  useEffect(() => {
    if (!editor) return;
    const container = editor.view.dom.parentElement;
    if (!container) return;

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const isProseMirrorContent =
        target.closest(".ProseMirror") !== null &&
        target !== editor.view.dom;

      if (isProseMirrorContent) return;
      if (e.button !== 0) return;

      startRef.current = { x: e.clientX, y: e.clientY };
      activeRef.current = false;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!startRef.current) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;

      if (!activeRef.current && Math.sqrt(dx * dx + dy * dy) < 8) return;
      activeRef.current = true;

      const rect: Rect = {
        x: Math.min(e.clientX, startRef.current.x),
        y: Math.min(e.clientY, startRef.current.y),
        w: Math.abs(dx),
        h: Math.abs(dy),
      };
      setDragRect(rect);
      updateSelection(rect);
    };

    const onMouseUp = () => {
      const wasTracking = startRef.current !== null;
      startRef.current = null;
      setDragRect(null);
      if (wasTracking && !activeRef.current) {
        clearSelection();
      }
      activeRef.current = false;
    };

    container.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      container.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [editor, updateSelection, clearSelection]);

  // Escape로 선택 해제
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedStarts.length > 0) {
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedStarts, clearSelection]);

  // Backspace/Delete로 선택된 블럭 삭제
  useEffect(() => {
    if (!editor || selectedStarts.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      if (document.activeElement?.closest(".ProseMirror")) return;
      e.preventDefault();
      const tr = editor.state.tr;
      const sorted = [...selectedStarts].sort((a, b) => b - a);
      for (const pos of sorted) {
        const node = editor.state.doc.nodeAt(pos);
        if (!node) continue;
        const mappedPos = tr.mapping.map(pos);
        tr.delete(mappedPos, mappedPos + node.nodeSize);
      }
      editor.view.dispatch(tr);
      clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, selectedStarts, clearSelection]);

  return { dragRect, selectedStarts, clearSelection };
}
