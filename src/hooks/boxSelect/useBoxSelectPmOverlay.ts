import { type RefObject, useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { topLevelBlockStartsInSelectionRange } from "../../lib/pm/topLevelBlocks";
import { hideGroupOverlay, paintOverlayForPositions } from "./overlayDom";

/** PM 텍스트 선택이 doc 직속 블록 2개 이상을 가로지르면 그룹 오버레이를 그린다. 마퀴 활성 중에는 비활성. */
export function useBoxSelectPmOverlay(
  editor: Editor | null,
  activeRef: RefObject<boolean>,
  selectedStartsRef: RefObject<number[]>,
): void {
  const prevPmStartsRef = useRef<number[]>([]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    const arraysEqual = (a: number[], b: number[]) => {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    };

    const apply = () => {
      if (activeRef.current) return;
      // 그룹 오버레이 dragstart → startContiguousBlocksNativeDrag 가 setSelection 을 dispatch 하면
      // selectionUpdate 가 즉시 발화한다. 이때 페인트 하면 숨겨둔 오버레이가 드래그 도중 다시 떠
      // drop 이 PM 대신 오버레이로 떨어져 이동이 전혀 적용되지 않는다.
      if (document.body.classList.contains("quicknote-block-dragging")) return;
      const sel = editor.state.selection;
      if (sel.from === sel.to) {
        if (selectedStartsRef.current.length === 0) hideGroupOverlay(editor);
        prevPmStartsRef.current = [];
        return;
      }
      const pmStarts = topLevelBlockStartsInSelectionRange(
        editor.state.doc,
        sel.from,
        sel.to,
      );
      if (pmStarts.length < 2) {
        if (selectedStartsRef.current.length === 0) hideGroupOverlay(editor);
        prevPmStartsRef.current = [];
        return;
      }
      if (arraysEqual(pmStarts, prevPmStartsRef.current)) return;
      prevPmStartsRef.current = pmStarts;
      paintOverlayForPositions(editor, pmStarts);
    };

    editor.on("selectionUpdate", apply);
    apply();
    return () => {
      editor.off("selectionUpdate", apply);
    };
  }, [editor, activeRef, selectedStartsRef]);
}
