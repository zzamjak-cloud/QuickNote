import { type RefObject, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { writeBlocksToClipboard } from "./clipboardBlocks";

/**
 * 잘라내기(Ctrl/Cmd+X):
 *  - 박스 선택된 블록들: 클립보드에 직렬화 후 일괄 삭제.
 *  - 이미지/파일 등 NodeSelection: 기본 cut 이 atom 노드에서 동작하지 않으므로,
 *    직접 클립보드에 싣고 노드를 삭제한다(복사만 되고 잘라내기는 안 되던 문제 수정).
 * 마퀴 확정 시 PM selection 이 collapse 되므로 copy 훅과 동일하게 window capture 로 처리한다.
 */
export function useBoxSelectCutBlocks(
  editor: Editor | null,
  selectedStartsRef: RefObject<number[]>,
  clearSelection: () => void,
): void {
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.key === "Process") return;
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "x") return;
      // 사용자가 텍스트를 따로 드래그 선택해 둔 경우는 브라우저 기본 잘라내기에 양보.
      const domSel = window.getSelection();
      if (domSel && !domSel.isCollapsed) return;

      const { doc, schema } = editor.state;
      const starts = selectedStartsRef.current;

      // 1) 박스 선택 다중 블록
      if (starts.length > 0) {
        const sortedAsc = [...starts].sort((a, b) => a - b);
        const nodes = sortedAsc
          .map((pos) => doc.nodeAt(pos))
          .filter((node): node is NonNullable<typeof node> => Boolean(node));
        if (nodes.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        writeBlocksToClipboard(nodes, schema);
        const tr = editor.state.tr;
        for (const pos of [...starts].sort((a, b) => b - a)) {
          const node = doc.nodeAt(pos);
          if (!node) continue;
          const mapped = tr.mapping.map(pos);
          tr.delete(mapped, mapped + node.nodeSize);
        }
        if (tr.docChanged) {
          editor.view.dispatch(tr.scrollIntoView());
          editor.view.focus();
          clearSelection();
        }
        return;
      }

      // 2) 단일 노드 선택(이미지/파일 등 atom)
      const sel = editor.state.selection;
      if (sel instanceof NodeSelection) {
        e.preventDefault();
        e.stopPropagation();
        writeBlocksToClipboard([sel.node], schema);
        editor
          .chain()
          .deleteRange({ from: sel.from, to: sel.to })
          .focus()
          .run();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editor, selectedStartsRef, clearSelection]);
}
