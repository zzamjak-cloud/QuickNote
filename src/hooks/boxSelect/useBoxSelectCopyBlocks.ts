import { type RefObject, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { writeBlocksToClipboard } from "./clipboardBlocks";

/**
 * 박스 선택된 블록 일괄 복사(Ctrl/Cmd+C).
 * 마퀴 확정 시 PM selection 은 collapse 되므로 기본 복사로는 아무것도 안 담긴다 —
 * 선택 블록들을 schema 직렬화 HTML(text/html) + 평문(text/plain)으로 클립보드에 싣는다.
 * 에디터에 붙여넣으면 PM 이 HTML 을 파싱해 블록이 그대로 재구성된다.
 */
export function useBoxSelectCopyBlocks(
  editor: Editor | null,
  selectedStartsRef: RefObject<number[]>,
): void {
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.key === "Process") return;
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "c") return;
      if (selectedStartsRef.current.length === 0) return;
      // 사용자가 텍스트를 따로 드래그 선택해 둔 경우는 브라우저 기본 복사에 양보
      const domSel = window.getSelection();
      if (domSel && !domSel.isCollapsed) return;

      const { doc, schema } = editor.state;
      const sorted = [...selectedStartsRef.current].sort((a, b) => a - b);
      const nodes = sorted
        .map((pos) => doc.nodeAt(pos))
        .filter((node): node is NonNullable<typeof node> => Boolean(node));
      if (nodes.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      writeBlocksToClipboard(nodes, schema);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editor, selectedStartsRef]);
}
