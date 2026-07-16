// 댓글 재앵커 픽 모드 — 앵커가 어긋난 스레드를 사용자가 클릭한 블록으로 이동
// (과거 블록 복제/분할로 blockId 대응이 틀어진 기존 댓글의 수동 복구 수단)

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { NodeSelection } from "@tiptap/pm/state";
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

/** 클릭 후 PM selection 기준으로 댓글 가능 블록의 시작 위치 해석 */
function resolveClickedCommentBlockStart(editor: Editor): number | null {
  const sel = editor.state.selection;
  // 이미지 등 atom 블록은 클릭 시 NodeSelection 이 된다
  if (sel instanceof NodeSelection && canBlockHaveComment(sel.node.type.name)) {
    return sel.from;
  }
  const { $from } = sel;
  for (let d = $from.depth; d > 0; d -= 1) {
    const node = $from.node(d);
    if (node.isTextblock && canBlockHaveComment(node.type.name)) {
      return $from.before(d);
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
    const dom = liveEditor.view.dom;
    // click(=mouseup 이후) 시점엔 PM 이 selection 을 이미 옮겨놓았다 — 그 selection 으로 해석
    const onClick = () => {
      const blockStart = resolveClickedCommentBlockStart(liveEditor);
      if (blockStart == null) {
        showToast("댓글을 붙일 수 없는 위치입니다. 다른 블럭을 클릭해 주세요.", {
          kind: "error",
        });
        return;
      }
      const toBlockId = ensureBlockId(liveEditor, blockStart);
      if (!toBlockId) return;
      const moved = moveThread(reanchor.pageId, reanchor.blockId, toBlockId);
      if (moved > 0) {
        showToast(`댓글 ${moved}개를 선택한 블럭으로 이동했습니다.`);
        dispatchDecoRefresh(liveEditor);
      }
      clearCommentReanchor();
    };
    dom.addEventListener("click", onClick);
    return () => dom.removeEventListener("click", onClick);
  }, [reanchor, liveEditor, moveThread, clearCommentReanchor, showToast]);

  if (!reanchor) return null;

  return createPortal(
    <div className="fixed bottom-6 left-1/2 z-[600] flex -translate-x-1/2 items-center gap-3 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-800 shadow-lg dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100">
      <span>댓글을 이동할 블럭을 클릭하세요</span>
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
