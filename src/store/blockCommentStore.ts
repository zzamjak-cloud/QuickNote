/**
 * 블록 댓글 스토어 — Comment 독립 엔티티 아키텍처.
 * 메시지는 AppSync Comment 테이블과 직접 동기화되며 Page JSON 에 임베딩되지 않는다.
 * threadVisitedAt 은 디바이스 로컬 상태로만 유지된다(서버 미동기).
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { newId } from "../lib/id";
import type { BlockCommentMsg } from "../types/blockComment";
import { useWorkspaceStore } from "./workspaceStore";
import { useNotificationStore } from "./notificationStore";
import { usePageStore } from "./pageStore";
import { normalizeMentionMemberIds } from "../lib/comments/mentionMemberIds";
import { enqueueAsync } from "../lib/sync/runtime";

export type { BlockCommentMsg } from "../types/blockComment";
import type { PersistedObject } from "../lib/migrations/persistedStore";

/** @deprecated 레거시 persist 마이그레이션 — messages 가 더 이상 persist 되지 않으므로 no-op */
export function migrateBlockCommentStore(
  _persisted: unknown,
  _fromVersion: number,
): PersistedObject {
  return { messages: [], threadVisitedAt: {} };
}

function getCurrentWorkspaceId(): string | null {
  return useWorkspaceStore.getState().currentWorkspaceId ?? null;
}

function messageBelongsToCurrentWorkspace(msg: BlockCommentMsg): boolean {
  const current = getCurrentWorkspaceId();
  return !current || msg.workspaceId == null || msg.workspaceId === current;
}

function threadKey(pageId: string, blockId: string): string {
  return `${pageId}:${blockId}`;
}

function msToIso(ms: number): string {
  return new Date(ms).toISOString();
}

function enqueueUpsertComment(msg: BlockCommentMsg): void {
  enqueueAsync("upsertComment", {
    id: msg.id,
    workspaceId: msg.workspaceId ?? getCurrentWorkspaceId() ?? "",
    pageId: msg.pageId,
    blockId: msg.blockId,
    authorMemberId: msg.authorMemberId,
    bodyText: msg.bodyText,
    mentionMemberIds: JSON.stringify(msg.mentionMemberIds),
    parentId: msg.parentId,
    createdAt: msToIso(msg.createdAt),
    updatedAt: msToIso(Date.now()),
  });
}

function enqueueSoftDeleteComment(id: string, workspaceId: string): void {
  enqueueAsync("softDeleteComment", {
    id,
    workspaceId,
    updatedAt: msToIso(Date.now()),
  });
}

function notifyCommentMentions(
  before: BlockCommentMsg | null,
  after: BlockCommentMsg,
): void {
  const beforeIds = new Set(before?.mentionMemberIds ?? []);
  const page = usePageStore.getState().pages[after.pageId];
  const notificationStore = useNotificationStore.getState();

  for (const memberId of after.mentionMemberIds) {
    if (beforeIds.has(memberId)) {
      notificationStore.updateNotificationByCommentId(after.id, {
        pageTitle: page?.title ?? "페이지",
        previewBody: after.bodyText,
      });
      continue;
    }

    notificationStore.addNotification({
      recipientMemberId: memberId,
      kind: "mention",
      source: "comment",
      workspaceId: after.workspaceId ?? getCurrentWorkspaceId(),
      pageTitle: page?.title ?? "페이지",
      pageId: after.pageId,
      blockId: after.blockId,
      fromMemberId: after.authorMemberId,
      commentId: after.id,
      previewBody: after.bodyText,
    });
  }
}

type BlockCommentState = {
  messages: BlockCommentMsg[];
  /** 스레드별 마지막 확인 시각 — 디바이스 로컬 전용, 서버 미동기 */
  threadVisitedAt: Record<string, number>;
};

type BlockCommentActions = {
  addMessage: (
    input: Omit<BlockCommentMsg, "id" | "createdAt"> & { id?: string },
  ) => BlockCommentMsg;
  updateMessage: (
    id: string,
    patch: { bodyText: string; mentionMemberIds: string[] },
  ) => boolean;
  deleteMessage: (id: string) => void;
  messagesForBlock: (pageId: string, blockId: string) => BlockCommentMsg[];
  participantIdsForBlock: (pageId: string, blockId: string) => string[];
  markThreadVisited: (pageId: string, blockId: string) => void;
  hasUnreadFromOthers: (
    pageId: string,
    blockId: string,
    myMemberId: string | undefined,
  ) => boolean;
  /** 원격에서 수신한 메시지를 스토어에 upsert (storeApply 에서 호출) */
  applyRemoteMessage: (msg: BlockCommentMsg) => void;
  /** 원격에서 softDelete 된 메시지 제거 (storeApply 에서 호출) */
  removeMessage: (id: string) => void;
  /** 워크스페이스 전환 시 댓글 상태 초기화 */
  clearMessages: () => void;
};

export const useBlockCommentStore = create<BlockCommentState & BlockCommentActions>()(
  persist(
    (set, get) => ({
      messages: [],
      threadVisitedAt: {},

      addMessage: (input) => {
        const msg: BlockCommentMsg = {
          id: input.id ?? newId(),
          workspaceId: input.workspaceId ?? getCurrentWorkspaceId(),
          pageId: input.pageId,
          blockId: input.blockId,
          authorMemberId: input.authorMemberId,
          bodyText: input.bodyText,
          mentionMemberIds: normalizeMentionMemberIds(input.mentionMemberIds),
          parentId: input.parentId,
          createdAt: Date.now(),
        };
        // 중복 방지
        if (get().messages.some((m) => m.id === msg.id)) return msg;
        set((s) => ({ messages: [...s.messages, msg] }));
        notifyCommentMentions(null, msg);
        enqueueUpsertComment(msg);
        return msg;
      },

      updateMessage: (id, patch) => {
        const existing = get().messages.find((m) => m.id === id);
        if (!existing) return false;
        const nextMentions = normalizeMentionMemberIds(patch.mentionMemberIds);
        const updated: BlockCommentMsg = {
          ...existing,
          bodyText: patch.bodyText,
          mentionMemberIds: nextMentions,
        };
        set((s) => ({
          messages: s.messages.map((m) => (m.id === id ? updated : m)),
        }));
        notifyCommentMentions(existing, updated);
        enqueueUpsertComment(updated);
        return true;
      },

      deleteMessage: (id) => {
        const msg = get().messages.find((m) => m.id === id);
        if (!msg) return;
        set((s) => ({ messages: s.messages.filter((m) => m.id !== id) }));
        enqueueSoftDeleteComment(id, msg.workspaceId ?? getCurrentWorkspaceId() ?? "");
      },

      messagesForBlock: (pageId, blockId) =>
        get()
          .messages.filter(
            (m) =>
              messageBelongsToCurrentWorkspace(m) &&
              m.pageId === pageId &&
              m.blockId === blockId,
          )
          .sort((a, b) => a.createdAt - b.createdAt),

      participantIdsForBlock: (pageId, blockId) => {
        const ids = new Set<string>();
        for (const m of get().messages) {
          if (!messageBelongsToCurrentWorkspace(m)) continue;
          if (m.pageId !== pageId || m.blockId !== blockId) continue;
          ids.add(m.authorMemberId);
        }
        return [...ids];
      },

      markThreadVisited: (pageId, blockId) => {
        set((s) => ({
          threadVisitedAt: {
            ...s.threadVisitedAt,
            [threadKey(pageId, blockId)]: Date.now(),
          },
        }));
      },

      hasUnreadFromOthers: (pageId, blockId, myMemberId) => {
        if (!myMemberId) return false;
        const visited = get().threadVisitedAt[threadKey(pageId, blockId)] ?? 0;
        return get().messages.some(
          (m) =>
            messageBelongsToCurrentWorkspace(m) &&
            m.pageId === pageId &&
            m.blockId === blockId &&
            m.authorMemberId !== myMemberId &&
            m.createdAt > visited,
        );
      },

      applyRemoteMessage: (msg) => {
        set((s) => {
          const idx = s.messages.findIndex((m) => m.id === msg.id);
          if (idx === -1) return { messages: [...s.messages, msg] };
          const next = [...s.messages];
          next[idx] = msg;
          return { messages: next };
        });
      },

      removeMessage: (id) => {
        set((s) => ({ messages: s.messages.filter((m) => m.id !== id) }));
      },

      clearMessages: () => {
        set({ messages: [] });
      },
    }),
    {
      name: "quicknote.blockComments.v1",
      storage: createJSONStorage(() => localStorage),
      // threadVisitedAt 만 localStorage 에 유지. messages 는 부트 시 서버에서 재로드.
      partialize: (s) => ({ threadVisitedAt: s.threadVisitedAt }),
    },
  ),
);
