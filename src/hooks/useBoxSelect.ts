import { useCallback, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { Rect } from "./boxSelect/types";
import {
  getTopLevelBlocks,
  hideGroupOverlay,
  showGroupOverlayForRects,
} from "./boxSelect/overlayDom";
import { useBoxSelectCommittedOverlay } from "./boxSelect/useBoxSelectCommittedOverlay";
import { useBoxSelectDeleteBlocks } from "./boxSelect/useBoxSelectDeleteBlocks";
import { useBoxSelectEscape } from "./boxSelect/useBoxSelectEscape";
import { useBoxSelectMarquee } from "./boxSelect/useBoxSelectMarquee";
import { useBoxSelectPmOverlay } from "./boxSelect/useBoxSelectPmOverlay";

export function useBoxSelect(editor: Editor | null) {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [selectedStarts, setSelectedStarts] = useState<number[]>([]);
  const activeRef = useRef(false);
  const dragRectRef = useRef<Rect | null>(null);
  const selectedStartsRef = useRef<number[]>([]);

  const clearSelection = useCallback(() => {
    selectedStartsRef.current = [];
    setSelectedStarts([]);
    hideGroupOverlay(editor);
  }, [editor]);

  const updateSelectionDom = useCallback(
    (rect: Rect) => {
      if (!editor) return;
      const blocks = getTopLevelBlocks(editor);
      const intersectedRects: DOMRect[] = [];
      const newStarts: number[] = [];
      blocks.forEach(({ el, pos }) => {
        const br = el.getBoundingClientRect();
        const intersects =
          br.left < rect.x + rect.w &&
          br.right > rect.x &&
          br.top < rect.y + rect.h &&
          br.bottom > rect.y;
        if (intersects) {
          intersectedRects.push(br);
          newStarts.push(pos);
        }
      });
      selectedStartsRef.current = newStarts;
      showGroupOverlayForRects(editor, intersectedRects);
    },
    [editor],
  );

  useBoxSelectMarquee({
    editor,
    startRef,
    activeRef,
    dragRectRef,
    selectedStartsRef,
    clearSelection,
    setSelectedStarts,
    updateSelectionDom,
  });

  useBoxSelectPmOverlay(editor, activeRef, selectedStartsRef);
  useBoxSelectCommittedOverlay(editor, selectedStarts);
  useBoxSelectEscape(editor, selectedStartsRef, clearSelection);
  useBoxSelectDeleteBlocks(editor, selectedStartsRef, clearSelection);

  return { selectedStarts, clearSelection };
}
