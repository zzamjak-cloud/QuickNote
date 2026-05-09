import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { zustandStorage } from "../lib/storage/index";
import { newId } from "../lib/id";
import { useNotificationStore } from "./notificationStore";

/** 블록 스레드 내 단일 댓글 */
export type BlockCommentMsg = {
  id: string;
  pageId: string;
  blockId: string;
  authorMemberId: string;
  bodyText: string;
  mentionMemberIds: string[];
  parentId: string | null;
  createdAt: number;
};

type BlockCommentState = {
  messages: BlockCommentMsg[];
  /** 스레드 마지막 확인 시각 — `${pageId}:${blockId}` → 열어본 시각(epoch) */
  threadVisitedAt: Record<string, number>;
};

type BlockCommentActions = {
  addMessage: (
    input: Omit<BlockCommentMsg, "id" | "createdAt"> & { id?: string },
  ) => BlockCommentMsg;
  /** 본인 댓글 본문·멘션 수정 */
  updateMessage: (
    id: string,
    patch: { bodyText: string; mentionMemberIds: string[] },
  ) => boolean;
  /** 댓글 삭제(본인만 UI에서 호출) */
  deleteMessage: (id: string) => void;
  messagesForBlock: (pageId: string, blockId: string) => BlockCommentMsg[];
  participantIdsForBlock: (pageId: string, blockId: string) => string[];
  markThreadVisited: (pageId: string, blockId: string) => void;
  /** 다른 사람이 남긴 미확인 댓글 존재(방문 이후 새 글) */
  hasUnreadFromOthers: (
    pageId: string,
    blockId: string,
    myMemberId: string | undefined,
  ) => boolean;
};

function threadKey(pageId: string, blockId: string): string {
  return `${pageId}:${blockId}`;
}

/** 새 글 추가 전까지의 스레드 참여자에게만 답글 알림(첫 글은 빈 배열) */
function dispatchNotificationsForMessage(
  msg: BlockCommentMsg,
  priorParticipants: string[],
): void {
  const notified = new Set<string>();

  for (const mid of msg.mentionMemberIds) {
    if (mid === msg.authorMemberId) continue;
    notified.add(mid);
    useNotificationStore.getState().addNotification({
      recipientMemberId: mid,
      kind: "mention",
      pageId: msg.pageId,
      blockId: msg.blockId,
      fromMemberId: msg.authorMemberId,
      commentId: msg.id,
      previewBody: msg.bodyText.slice(0, 140),
    });
  }

  for (const mid of priorParticipants) {
    if (mid === msg.authorMemberId) continue;
    if (notified.has(mid)) continue;
    notified.add(mid);
    useNotificationStore.getState().addNotification({
      recipientMemberId: mid,
      kind: "thread_reply",
      pageId: msg.pageId,
      blockId: msg.blockId,
      fromMemberId: msg.authorMemberId,
      commentId: msg.id,
      previewBody: msg.bodyText.slice(0, 140),
    });
  }
}

export const useBlockCommentStore = create<BlockCommentState & BlockCommentActions>()(
  persist(
    (set, get) => ({
      messages: [],
      threadVisitedAt: {},
      addMessage: (input) => {
        const priorParticipants = get().participantIdsForBlock(
          input.pageId,
          input.blockId,
        );
        const msg: BlockCommentMsg = {
          id: input.id ?? newId(),
          pageId: input.pageId,
          blockId: input.blockId,
          authorMemberId: input.authorMemberId,
          bodyText: input.bodyText,
          mentionMemberIds: input.mentionMemberIds,
          parentId: input.parentId,
          createdAt: Date.now(),
        };
        set((s) => ({ messages: [...s.messages, msg] }));
        dispatchNotificationsForMessage(msg, priorParticipants);
        return msg;
      },
      updateMessage: (id, patch) => {
        let ok = false;
        set((s) => ({
          messages: s.messages.map((m) => {
            if (m.id !== id) return m;
            ok = true;
            return {
              ...m,
              bodyText: patch.bodyText,
              mentionMemberIds: patch.mentionMemberIds,
            };
          }),
        }));
        return ok;
      },
      deleteMessage: (id) =>
        set((s) => ({ messages: s.messages.filter((m) => m.id !== id) })),
      messagesForBlock: (pageId, blockId) =>
        get()
          .messages.filter((m) => m.pageId === pageId && m.blockId === blockId)
          .sort((a, b) => a.createdAt - b.createdAt),
      participantIdsForBlock: (pageId, blockId) => {
        const ids = new Set<string>();
        for (const m of get().messages) {
          if (m.pageId !== pageId || m.blockId !== blockId) continue;
          ids.add(m.authorMemberId);
        }
        return [...ids];
      },
      markThreadVisited: (pageId, blockId) =>
        set((s) => ({
          threadVisitedAt: {
            ...s.threadVisitedAt,
            [threadKey(pageId, blockId)]: Date.now(),
          },
        })),
      hasUnreadFromOthers: (pageId, blockId, myMemberId) => {
        if (!myMemberId) return false;
        const visited = get().threadVisitedAt[threadKey(pageId, blockId)] ?? 0;
        return get().messages.some(
          (m) =>
            m.pageId === pageId &&
            m.blockId === blockId &&
            m.authorMemberId !== myMemberId &&
            m.createdAt > visited,
        );
      },
    }),
    {
      name: "quicknote.blockComments.v1",
      storage: createJSONStorage(() => zustandStorage),
      version: 1,
    },
  ),
);
