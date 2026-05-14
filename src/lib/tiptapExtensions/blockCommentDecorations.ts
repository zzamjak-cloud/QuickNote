import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { useBlockCommentStore } from "../../store/blockCommentStore";
import { useMemberStore } from "../../store/memberStore";
import { usePageStore } from "../../store/pageStore";

export const blockCommentDecoKey = new PluginKey("qn-block-comment-deco");

/** 댓글/미확인 블록 — PM Decoration으로 DOM class 유지(React NodeView·classList 덮어쓰기 대응) */
export function createBlockCommentDecorations(
  pageId: string | undefined,
  myMemberId: string | undefined,
) {
  return Extension.create({
    name: "blockCommentDecorations",
    addProseMirrorPlugins() {
      const myId = myMemberId;
      return [
        new Plugin({
          key: blockCommentDecoKey,
          props: {
            decorations(state) {
              // 클로저 pageId 는 플러그인 생성 시점에 고정되므로 항상 스토어에서 최신값을 읽는다.
              const currentPageId = usePageStore.getState().activePageId ?? undefined;
              if (!currentPageId) return null;
              const currentMemberId = myId ?? useMemberStore.getState().me?.memberId;
              const hasUnread = useBlockCommentStore.getState().hasUnreadFromOthers;
              const messages = useBlockCommentStore.getState().messages.filter(
                (m) => m.pageId === currentPageId,
              );
              const countBy = new Map<string, number>();
              for (const m of messages) {
                countBy.set(m.blockId, (countBy.get(m.blockId) ?? 0) + 1);
              }

              const decos: Decoration[] = [];
              // ID 중복(엔터로 블록 분할 시 일시적으로 동일 id) 가 있을 때
              // 첫 번째 블록만 스타일 적용 — 신규 분할 블록에 댓글 표시가 번지지 않도록
              const seen = new Set<string>();
              state.doc.descendants((node, pos) => {
                const id = node.attrs?.id as string | undefined;
                if (!id) return;
                if (seen.has(id)) return;
                seen.add(id);
                const n = countBy.get(id) ?? 0;
                const unread =
                  !!currentMemberId &&
                  hasUnread(currentPageId, id, currentMemberId);
                if (n === 0 && !unread) return;
                const classes = [
                  n > 0 ? "qn-block-has-comments" : "",
                  unread ? "qn-block-comment-glow" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                if (!classes) return;
                decos.push(
                  Decoration.node(pos, pos + node.nodeSize, { class: classes }),
                );
              });
              return DecorationSet.create(state.doc, decos);
            },
          },
        }),
      ];
    },
  });
}

/** 스토어 갱신 시 decoration 다시 그리기 */
export function dispatchDecoRefresh(editor: Editor): void {
  try {
    editor.view.dispatch(editor.state.tr);
  } catch {
    /* noop */
  }
}
