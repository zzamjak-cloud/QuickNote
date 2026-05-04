import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { hideGroupOverlay, paintOverlayForPositions } from "./overlayDom";

/** 박스 선택 commit 후 selectedStarts 가 바뀔 때 오버레이 재계산 */
export function useBoxSelectCommittedOverlay(
  editor: Editor | null,
  selectedStarts: number[],
): void {
  useEffect(() => {
    if (!editor) return;
    if (selectedStarts.length === 0) {
      hideGroupOverlay(editor);
      return;
    }
    paintOverlayForPositions(editor, selectedStarts);
  }, [editor, selectedStarts]);
}
