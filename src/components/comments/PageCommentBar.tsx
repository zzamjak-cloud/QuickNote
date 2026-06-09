// 페이지 레벨 댓글 바 — 제목 아래 / 속성 패널 아래에 인라인으로 표시

import { useState, useEffect, useMemo, useRef } from "react";
import { MessageSquare, Pencil, Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useBlockCommentStore } from "../../store/blockCommentStore";
import { useMemberStore } from "../../store/memberStore";
import type { BlockCommentMsg } from "../../types/blockComment";
import type { JSONContent } from "@tiptap/react";
import { CommentComposer } from "./CommentComposer";

/** 페이지 댓글임을 나타내는 sentinel — blockId 자리에 사용 */
export const PAGE_COMMENT_SENTINEL = "__page__";

type Props = {
  pageId: string;
  /** 외부(제목 표시줄의 "댓글 추가" 버튼)에서 입력창을 열기 위한 신호. 값이 증가하면 입력창을 연다. */
  openComposerSignal?: number;
};

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PageCommentBar({ pageId, openComposerSignal }: Props) {
  const addMessage = useBlockCommentStore((s) => s.addMessage);
  const updateMessage = useBlockCommentStore((s) => s.updateMessage);
  const deleteMessage = useBlockCommentStore((s) => s.deleteMessage);
  // 페이지 댓글만 필터링 — blockId === PAGE_COMMENT_SENTINEL
  const messages = useBlockCommentStore((s) =>
    s.messages
      .filter((m) => m.pageId === pageId && m.blockId === PAGE_COMMENT_SENTINEL)
      .sort((a, b) => a.createdAt - b.createdAt),
  );
  const members = useMemberStore(
    useShallow((s) => s.members.map((m) => ({ memberId: m.memberId, name: m.name }))),
  );
  const myMemberId = useMemberStore((s) => s.me?.memberId);

  // 댓글이 1개 이상이면 기본 펼침 — 사용자가 수동으로 접은 경우는 유지
  const [expanded, setExpanded] = useState(() => messages.length > 0);
  const userCollapsedRef = useRef(false);
  // 첫 데이터 로드 시 (0→N) 한 번만 자동 펼침 — 이미 사용자가 접었으면 무시
  useEffect(() => {
    if (messages.length > 0 && !userCollapsedRef.current) {
      setExpanded(true);
    }
  }, [messages.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // 입력창 표시 토글 — 접혀 있을 때 클릭하면 펼치고 입력창 포커스
  const [composerVisible, setComposerVisible] = useState(false);

  // 제목 표시줄의 "댓글 추가" 버튼 신호 — 값이 바뀌면 입력창을 연다.
  useEffect(() => {
    if (openComposerSignal && openComposerSignal > 0) {
      setComposerVisible(true);
      setExpanded(true);
    }
  }, [openComposerSignal]);

  const memberName = (id: string) =>
    members.find((m) => m.memberId === id)?.name ?? "구성원";

  const handleSubmit = (bodyText: string, mentionIds: string[]) => {
    if (!myMemberId) return;
    addMessage({
      pageId,
      blockId: PAGE_COMMENT_SENTINEL,
      authorMemberId: myMemberId,
      bodyText,
      mentionMemberIds: mentionIds,
      parentId: null,
    });
    setComposerVisible(false);
    setExpanded(true);
  };

  const hasComments = messages.length > 0;

  // 댓글도 없고 입력창도 닫혀 있으면 아무것도 렌더하지 않는다.
  // (추가 진입점은 제목 표시줄의 "댓글 추가" 버튼으로 일원화 — 불필요한 라인 제거)
  if (!hasComments && !composerVisible) return null;

  return (
    <div data-qn-page-comment className="mt-2 mb-1 border-t border-zinc-100 pt-2 dark:border-zinc-800">
      {/* 댓글 헤더 행 — 댓글이 있을 때만 (보기/접기) */}
      {hasComments && (
        <div className="flex items-center gap-2">
          <MessageSquare size={15} className="shrink-0 text-zinc-400" />
          {!expanded && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              {messages.length}개 보기
            </button>
          )}
          {expanded && (
            <button
              type="button"
              onClick={() => { userCollapsedRef.current = true; setExpanded(false); }}
              className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              접기
            </button>
          )}
        </div>
      )}

      {/* 댓글 입력 컴포저 — @ 멘션 지원 */}
      {composerVisible && (
        <div className={hasComments ? "mt-2" : ""}>
          <CommentComposer
            autoFocus
            placeholder="댓글 입력 (@ 로 멘션 검색) — Enter 전송, Shift+Enter 줄바꿈"
            submitLabel="등록"
            clearOnSubmit
            onSubmit={handleSubmit}
            onCancel={() => setComposerVisible(false)}
          />
        </div>
      )}

      {/* 댓글 목록 — expanded 시만 표시 */}
      {expanded && hasComments && (
        <div className="mt-2 space-y-1.5">
          {messages.map((msg) => (
            <CommentRow
              key={msg.id}
              msg={msg}
              authorName={memberName(msg.authorMemberId)}
              isOwn={!!myMemberId && msg.authorMemberId === myMemberId}
              onUpdate={(text, mentionIds) =>
                updateMessage(msg.id, { bodyText: text, mentionMemberIds: mentionIds })
              }
              onDelete={() => deleteMessage(msg.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CommentRow({
  msg,
  authorName,
  isOwn,
  onUpdate,
  onDelete,
}: {
  msg: BlockCommentMsg;
  authorName: string;
  isOwn: boolean;
  onUpdate: (text: string, mentionIds: string[]) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);

  // 수정 모드 진입 시 기존 본문을 paragraph JSON 으로 감싸 composer 초기값으로 전달
  const initialJson = useMemo<JSONContent>(
    () => ({
      type: "doc",
      content: [
        msg.bodyText.trim()
          ? {
              type: "paragraph",
              content: [{ type: "text", text: msg.bodyText }],
            }
          : { type: "paragraph" },
      ],
    }),
    [msg.bodyText],
  );

  if (editing) {
    return (
      <div className="rounded bg-zinc-50 px-2 py-1 dark:bg-zinc-800/60">
        <CommentComposer
          autoFocus
          placeholder="수정 내용 입력 (@ 로 멘션 검색)"
          submitLabel="저장"
          clearOnSubmit={false}
          initialJson={initialJson}
          initialJsonVersion={msg.id}
          onSubmit={(text, mentionIds) => {
            if (text) onUpdate(text, mentionIds);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  // 한 라인 레이아웃: [작성자 | 내용] 좌측 / [시간 | 버튼] 우측 (모두 상단 정렬, 내용 멀티라인)
  return (
    <div className="group flex items-start gap-3 rounded bg-zinc-50 px-2 py-1 dark:bg-zinc-800/60">
      <span className="shrink-0 pt-0.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
        {authorName}
      </span>
      <p className="min-w-0 flex-1 whitespace-pre-wrap pt-0.5 text-sm text-zinc-700 dark:text-zinc-300">
        {msg.bodyText}
      </p>
      <span className="shrink-0 pt-0.5 text-xs text-zinc-400">
        {formatTime(msg.createdAt)}
      </span>
      {isOwn && (
        <div className="flex shrink-0 items-start gap-1 pt-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
            title="편집"
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded p-0.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
            title="삭제"
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
