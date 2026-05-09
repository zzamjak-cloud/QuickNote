import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { useBlockCommentStore } from "../../store/blockCommentStore";

export const blockCommentDecoKey = new PluginKey("qn-block-comment-deco");

/** 댓글/미확인 블록 — PM Decoration으로 DOM class 유지(React NodeView·classList 덮어쓰기 대응) */
export function createBlockCommentDecorations(
  pageId: string | undefined,
  myMemberId: string | undefined,
) {
  return Extension.create({
    name: "blockCommentDecorations",
    addProseMirrorPlugins() {
      const pid = pageId;
      const myId = myMemberId;
      return [
        new Plugin({
          key: blockCommentDecoKey,
          props: {
            decorations(state) {
              if (!pid) return null;
              const hasUnread = useBlockCommentStore.getState().hasUnreadFromOthers;
              const messages = useBlockCommentStore.getState().messages.filter(
                (m) => m.pageId === pid,
              );
              const countBy = new Map<string, number>();
              for (const m of messages) {
                countBy.set(m.blockId, (countBy.get(m.blockId) ?? 0) + 1);
              }

              const decos: Decoration[] = [];
              state.doc.descendants((node, pos) => {
                const id = node.attrs?.id as string | undefined;
                if (!id) return;
                const n = countBy.get(id) ?? 0;
                const unread =
                  !!myId &&
                  hasUnread(pid, id, myId);
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
