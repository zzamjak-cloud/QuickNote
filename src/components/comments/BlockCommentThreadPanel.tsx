// 블록 댓글 스레드 — 노션형 타임라인 + 답글

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/react";
import { Pencil, Trash2, X } from "lucide-react";
import { useUiStore, type CommentThreadPayload } from "../../store/uiStore";
import { usePageStore } from "../../store/pageStore";
import { useMemberStore } from "../../store/memberStore";
import {
  useBlockCommentStore,
  type BlockCommentMsg,
} from "../../store/blockCommentStore";
import { CommentComposer } from "./CommentComposer";
import { findBlockStartById } from "../../lib/comments/ensureBlockId";
import { computeFloatingPanelPosition } from "../../lib/ui/clampFloatingPanel";

type Props = {
  editor: Editor | null;
};

const PANEL_W = 340;
/** max-h-[min(520px,85vh)] 과 맞춤 — 위치 계산용 근사 높이 */
function estimatedPanelHeight(): number {
  return Math.min(520, Math.floor(window.innerHeight * 0.85));
}

function memberName(members: { memberId: string; name: string }[], id: string): string {
  const m = members.find((x) => x.memberId === id);
  return m?.name ?? "구성원";
}

export function BlockCommentThreadPanel({ editor }: Props) {
  const payload = useUiStore((s) => s.commentThread);
  const closeCommentThread = useUiStore((s) => s.closeCommentThread);
  const members = useMemberStore((s) => s.members);
  const me = useMemberStore((s) => s.me);
  const addMessage = useBlockCommentStore((s) => s.addMessage);
  const updateMessage = useBlockCommentStore((s) => s.updateMessage);
  const deleteMessage = useBlockCommentStore((s) => s.deleteMessage);
  const markThreadVisited = useBlockCommentStore((s) => s.markThreadVisited);

  const pageId = payload?.pageId;
  const blockId = payload?.blockId;
  const pageExists = usePageStore((s) =>
    pageId ? s.pages[pageId] !== undefined : false,
  );

  const messages = useBlockCommentStore((s) =>
    pageId && blockId ? s.messagesForBlock(pageId, blockId) : [],
  );

  const [replyParentId, setReplyParentId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  /** 이전 스레드 — 닫기·다른 블록으로 전환 시 확인 시각 기록 */
  const payloadRef = useRef<CommentThreadPayload | null>(null);
  useEffect(() => {
    const prev = payloadRef.current;
    payloadRef.current = payload;
    if (
      prev &&
      (!payload ||
        prev.pageId !== payload.pageId ||
        prev.blockId !== payload.blockId)
    ) {
      markThreadVisited(prev.pageId, prev.blockId);
    }
  }, [payload, markThreadVisited]);

  const updateAnchorPosition = useCallback((): void => {
    if (!payload) {
      setAnchor(null);
      return;
    }
    const ph = estimatedPanelHeight();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (payload.anchorViewport) {
      const { top, left } = computeFloatingPanelPosition({
        anchor: payload.anchorViewport,
        panelWidth: PANEL_W,
        panelHeight: ph,
        vw,
        vh,
      });
      setAnchor({ top, left });
      return;
    }

    if (!editor || editor.isDestroyed) {
      setAnchor(null);
      return;
    }
    const start =
      payload.blockStart > 0
        ? payload.blockStart
        : findBlockStartById(editor, payload.blockId);
    if (start === null) {
      setAnchor(null);
      return;
    }
    const dom = editor.view.nodeDOM(start);
    const el = dom instanceof HTMLElement ? dom : dom?.parentElement;
    if (!el) {
      setAnchor(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const anchorRect = {
      top: r.top,
      left: r.left,
      right: r.right,
      bottom: r.bottom,
    };
    const { top, left } = computeFloatingPanelPosition({
      anchor: anchorRect,
      panelWidth: PANEL_W,
      panelHeight: ph,
      vw,
      vh,
    });
    setAnchor({ top, left });
  }, [payload, editor]);

  useLayoutEffect(() => {
    updateAnchorPosition();
  }, [updateAnchorPosition, messages.length]);

  useEffect(() => {
    if (!payload) return;
    const onResize = () => updateAnchorPosition();
    window.addEventListener("resize", onResize);
    const scroller = editor?.view.dom.closest(".overflow-y-auto");
    scroller?.addEventListener("scroll", onResize, { passive: true });
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      scroller?.removeEventListener("scroll", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [payload, editor, updateAnchorPosition]);

  if (!payload || !pageExists) return null;

  const myId = me?.memberId;
  const canPost = !!myId;

  const onSend = (text: string, mentionIds: string[]) => {
    if (!myId || !payload) return;
    addMessage({
      pageId: payload.pageId,
      blockId: payload.blockId,
      authorMemberId: myId,
      bodyText: text,
      mentionMemberIds: mentionIds,
      parentId: replyParentId,
    });
    setReplyParentId(null);
  };

  const handleClose = () => {
    closeCommentThread();
  };

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[375] cursor-default bg-black/10 dark:bg-black/30"
        aria-label="댓글 패널 배경 닫기"
        onClick={handleClose}
      />
      <aside
        className="fixed z-[380] flex max-h-[min(520px,85vh)] w-[340px] max-w-[calc(100vw-16px)] flex-col rounded-lg border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        style={
          anchor
            ? { top: anchor.top, left: anchor.left }
            : { top: "max(8px, 10vh)", left: 8, width: PANEL_W }
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby="qn-block-comment-title"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
          <h2
            id="qn-block-comment-title"
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
          >
            댓글 {messages.length > 0 ? `(${messages.length})` : ""}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2">
          {messages.length === 0 ? (
            <p className="text-xs text-zinc-500">아직 댓글이 없습니다.</p>
          ) : (
            messages.map((m) => (
              <CommentBubble
                key={m.id}
                msg={m}
                members={members}
                myMemberId={myId}
                onReply={() => setReplyParentId(m.id)}
                isReply={m.parentId !== null}
                onUpdateMessage={updateMessage}
                onDeleteMessage={deleteMessage}
              />
            ))
          )}
        </div>

        {replyParentId ? (
          <div className="border-t border-zinc-200 px-3 py-1 text-[11px] text-zinc-500 dark:border-zinc-700">
            답글 작성 중 ·{" "}
            <button
              type="button"
              className="text-emerald-600 hover:underline dark:text-emerald-400"
              onClick={() => setReplyParentId(null)}
            >
              취소
            </button>
          </div>
        ) : null}

        <div className="border-t border-zinc-200 p-3 dark:border-zinc-700">
          {canPost ? (
            <CommentComposer
              key={`${payload.pageId}-${payload.blockId}`}
              onSubmit={onSend}
              disabled={false}
              autoFocus
              submitLabel={replyParentId ? "답글 등록" : "댓글 등록"}
            />
          ) : (
            <p className="text-xs text-zinc-500">로그인 후 댓글을 남길 수 있습니다.</p>
          )}
        </div>
      </aside>
    </>
  );
}

function CommentBubble({
  msg,
  members,
  myMemberId,
  onReply,
  isReply,
  onUpdateMessage,
  onDeleteMessage,
}: {
  msg: BlockCommentMsg;
  members: { memberId: string; name: string }[];
  myMemberId: string | undefined;
  onReply: () => void;
  isReply: boolean;
  onUpdateMessage: (
    id: string,
    patch: { bodyText: string; mentionMemberIds: string[] },
  ) => void;
  onDeleteMessage: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const author = memberName(members, msg.authorMemberId);
  const time = new Date(msg.createdAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const isOwn = !!myMemberId && msg.authorMemberId === myMemberId;
  const initialJson: JSONContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: msg.bodyText
          ? [{ type: "text", text: msg.bodyText }]
          : [],
      },
    ],
  };

  if (editing) {
    return (
      <div
        className={[
          "rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-600 dark:bg-zinc-900",
          isReply ? "ml-3" : "",
        ].join(" ")}
      >
        <CommentComposer
          key={`${msg.id}-edit`}
          initialJson={initialJson}
          initialJsonVersion={msg.bodyText}
          clearOnSubmit={false}
          submitLabel="저장"
          onCancel={() => setEditing(false)}
          onSubmit={(text, ids) => {
            onUpdateMessage(msg.id, { bodyText: text, mentionMemberIds: ids });
            setEditing(false);
          }}
          autoFocus
        />
      </div>
    );
  }

  return (
    <div
      className={[
        "rounded-lg bg-zinc-50 px-2 py-1.5 dark:bg-zinc-800/80",
        isReply ? "ml-3 border-l-2 border-emerald-400 pl-2" : "",
      ].join(" ")}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
          {author}
        </span>
        <span className="shrink-0 text-[10px] text-zinc-400">{time}</span>
      </div>
      <p className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
        {msg.bodyText}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {isOwn ? (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-0.5 text-[11px] font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              <Pencil size={12} />
              편집
            </button>
            <button
              type="button"
              onClick={() => onDeleteMessage(msg.id)}
              className="inline-flex items-center gap-0.5 text-[11px] font-medium text-red-600 hover:underline dark:text-red-400"
            >
              <Trash2 size={12} />
              삭제
            </button>
          </>
        ) : null}
        <button
          type="button"
          onClick={onReply}
          className="text-[11px] font-medium text-emerald-600 hover:underline dark:text-emerald-400"
        >
          답글
        </button>
      </div>
    </div>
  );
}
