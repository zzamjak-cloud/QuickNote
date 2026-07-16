// 댓글 재앵커 픽 모드 — 앵커가 어긋난 스레드를 사용자가 클릭한 블록으로 이동
// (과거 블록 복제/분할로 blockId 대응이 틀어진 기존 댓글의 수동 복구 수단)

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { useUiStore } from "../../store/uiStore";
import { useBlockCommentStore } from "../../store/blockCommentStore";
import { canBlockHaveComment } from "../../lib/comments/blockCommentTargets";
import { ensureBlockId } from "../../lib/comments/ensureBlockId";
import { dispatchDecoRefresh } from "../../lib/tiptapExtensions/blockCommentDecorations";
import {
  getEditorForPage,
  subscribeEditorRegistry,
} from "../../lib/editor/editorByPageRegistry";

/**
 * 클릭 좌표 기준으로 댓글 가능 블록의 시작 위치 해석.
 * selection 기반은 NodeView(이미지·DB 블록 등)가 클릭을 삼키거나 selection 이
 * 갱신되지 않으면 엉뚱한(이전) 블록으로 해석되므로 좌표로 직접 해석한다.
 */
function resolveCommentBlockStartAtCoords(
  editor: Editor,
  clientX: number,
  clientY: number,
): number | null {
  const coords = editor.view.posAtCoords({ left: clientX, top: clientY });
  if (!coords) return null;
  const { doc } = editor.state;
  // 이미지·파일 등 atom 블록 직접 히트
  if (coords.inside >= 0) {
    const insideNode = doc.nodeAt(coords.inside);
    if (
      insideNode?.isAtom &&
      insideNode.isBlock &&
      canBlockHaveComment(insideNode.type.name)
    ) {
      return coords.inside;
    }
  }
  let $pos;
  try {
    $pos = doc.resolve(coords.pos);
  } catch {
    return null;
  }
  for (let d = $pos.depth; d > 0; d -= 1) {
    const node = $pos.node(d);
    if (node.isTextblock && canBlockHaveComment(node.type.name)) {
      return $pos.before(d);
    }
  }
  return null;
}

export function CommentReanchorMode() {
  const reanchor = useUiStore((s) => s.commentReanchor);
  const clearCommentReanchor = useUiStore((s) => s.clearCommentReanchor);
  const showToast = useUiStore((s) => s.showToast);
  const moveThread = useBlockCommentStore((s) => s.moveThread);
  const [liveEditor, setLiveEditor] = useState<Editor | null>(null);

  useEffect(() => {
    if (!reanchor) {
      setLiveEditor(null);
      return;
    }
    const sync = () => setLiveEditor(getEditorForPage(reanchor.pageId) ?? null);
    sync();
    return subscribeEditorRegistry(sync);
  }, [reanchor]);

  useEffect(() => {
    if (!reanchor) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        clearCommentReanchor();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [reanchor, clearCommentReanchor]);

  useEffect(() => {
    if (!reanchor || !liveEditor || liveEditor.isDestroyed) return;
    // NodeView 가 자체 클릭 처리로 이벤트를 삼켜도 픽이 동작하도록 document capture 에서 가로챈다
    const onClickCapture = (e: globalThis.MouseEvent) => {
      const target = e.target as Node | null;
      if (!target || !liveEditor.view.dom.contains(target)) return; // 본문 밖(배너·사이드바) 클릭은 무시
      e.preventDefault();
      e.stopPropagation();
      const blockStart = resolveCommentBlockStartAtCoords(
        liveEditor,
        e.clientX,
        e.clientY,
      );
      if (blockStart == null) {
        showToast("댓글을 붙일 수 없는 위치입니다. 다른 블럭을 클릭해 주세요.", {
          kind: "error",
        });
        return;
      }
      const toBlockId = ensureBlockId(liveEditor, blockStart);
      if (!toBlockId) {
        showToast("블럭 식별에 실패했습니다. 다시 시도해 주세요.", { kind: "error" });
        return;
      }
      const moved = moveThread(reanchor.pageId, reanchor.blockId, toBlockId);
      if (moved > 0) {
        showToast(`댓글 ${moved}개를 선택한 블럭으로 이동했습니다.`);
        dispatchDecoRefresh(liveEditor);
      } else if (reanchor.blockId === toBlockId) {
        showToast("이미 이 블럭에 연결된 댓글입니다.", { kind: "error" });
      } else {
        showToast("이동할 댓글을 찾지 못했습니다.", { kind: "error" });
      }
      clearCommentReanchor();
    };
    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, [reanchor, liveEditor, moveThread, clearCommentReanchor, showToast]);

  if (!reanchor) return null;

  return createPortal(
    <div className="fixed bottom-6 left-1/2 z-[600] flex -translate-x-1/2 items-center gap-3 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-800 shadow-lg dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100">
      <span>
        {liveEditor && !liveEditor.isDestroyed
          ? "댓글을 이동할 블럭을 클릭하세요"
          : "본문 에디터를 찾을 수 없습니다 — 해당 페이지를 연 상태에서 시도해 주세요"}
      </span>
      <button
        type="button"
        className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        onClick={clearCommentReanchor}
      >
        취소 (Esc)
      </button>
    </div>,
    document.body,
  );
}
