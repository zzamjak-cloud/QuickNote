import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { zustandStorage } from "../lib/storage/index";
import { newId } from "../lib/id";
import { useNotificationStore } from "./notificationStore";
import { normalizeMentionMemberIds } from "../lib/comments/mentionMemberIds";
import { usePageStore } from "./pageStore";
import { useWorkspaceStore } from "./workspaceStore";
import type { PersistedObject } from "../lib/migrations/persistedStore";
import { migratePersistedStore } from "../lib/migrations/persistedStore";

/** 블록 스레드 내 단일 댓글 */
export type BlockCommentMsg = {
  id: string;
  workspaceId?: string | null;
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

export const BLOCK_COMMENT_STORE_VERSION = 2;

function threadKey(pageId: string, blockId: string): string {
  return `${pageId}:${blockId}`;
}

function getCurrentWorkspaceId(): string | null {
  return useWorkspaceStore.getState().currentWorkspaceId ?? null;
}

function messageBelongsToCurrentWorkspace(msg: BlockCommentMsg): boolean {
  const current = getCurrentWorkspaceId();
  return !current || msg.workspaceId == null || msg.workspaceId === current;
}

function migrateBlockCommentMsg(value: unknown): BlockCommentMsg | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const msg = value as Partial<BlockCommentMsg>;
  if (
    typeof msg.id !== "string" ||
    typeof msg.pageId !== "string" ||
    typeof msg.blockId !== "string" ||
    typeof msg.authorMemberId !== "string"
  ) {
    return null;
  }
  return {
    id: msg.id,
    workspaceId: msg.workspaceId ?? null,
    pageId: msg.pageId,
    blockId: msg.blockId,
    authorMemberId: msg.authorMemberId,
    bodyText: typeof msg.bodyText === "string" ? msg.bodyText : "",
    mentionMemberIds: normalizeMentionMemberIds(msg.mentionMemberIds ?? []),
    parentId: typeof msg.parentId === "string" ? msg.parentId : null,
    createdAt: typeof msg.createdAt === "number" ? msg.createdAt : Date.now(),
  };
}

function migrateThreadVisitedAt(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const timestamp = Number(raw);
    if (key && Number.isFinite(timestamp) && timestamp > 0) {
      result[key] = timestamp;
    }
  }
  return result;
}

export function migrateBlockCommentStore(
  persisted: unknown,
  fromVersion: number,
): PersistedObject {
  return migratePersistedStore(
    persisted,
    fromVersion,
    [
      {
        version: 2,
        migrate: (state) => ({
          ...state,
          messages: Array.isArray(state.messages)
            ? state.messages.map(migrateBlockCommentMsg).filter(Boolean)
            : [],
          threadVisitedAt: migrateThreadVisitedAt(state.threadVisitedAt),
        }),
      },
    ],
    { messages: [], threadVisitedAt: {} },
  );
}

/** 새 글 추가 전까지의 스레드 참여자에게만 답글 알림(첫 글은 빈 배열) */
function dispatchNotificationsForMessage(
  msg: BlockCommentMsg,
  priorParticipants: string[],
): void {
  const notified = new Set<string>();
  const pageTitle = usePageStore.getState().pages[msg.pageId]?.title ?? "페이지";

  for (const mid of normalizeMentionMemberIds(msg.mentionMemberIds)) {
    if (mid === msg.authorMemberId) continue;
    notified.add(mid);
    useNotificationStore.getState().addNotification({
      recipientMemberId: mid,
      kind: "mention",
      source: "comment",
      pageTitle,
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
      source: "comment",
      pageTitle,
      pageId: msg.pageId,
      blockId: msg.blockId,
      fromMemberId: msg.authorMemberId,
      commentId: msg.id,
      previewBody: msg.bodyText.slice(0, 140),
    });
  }
}

function dispatchNewMentionNotifications(
  msg: BlockCommentMsg,
  mentionMemberIds: string[],
): void {
  const pageTitle = usePageStore.getState().pages[msg.pageId]?.title ?? "페이지";
  for (const mid of normalizeMentionMemberIds(mentionMemberIds)) {
    if (mid === msg.authorMemberId) continue;
    useNotificationStore.getState().addNotification({
      recipientMemberId: mid,
      kind: "mention",
      source: "comment",
      pageTitle,
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
          workspaceId: getCurrentWorkspaceId(),
          pageId: input.pageId,
          blockId: input.blockId,
          authorMemberId: input.authorMemberId,
          bodyText: input.bodyText,
          mentionMemberIds: normalizeMentionMemberIds(input.mentionMemberIds),
          parentId: input.parentId,
          createdAt: Date.now(),
        };
        set((s) => ({ messages: [...s.messages, msg] }));
        dispatchNotificationsForMessage(msg, priorParticipants);
        return msg;
      },
      updateMessage: (id, patch) => {
        let ok = false;
        let updated: BlockCommentMsg | null = null;
        let newlyMentioned: string[] = [];
        set((s) => ({
          messages: s.messages.map((m) => {
            if (m.id !== id) return m;
            ok = true;
            const prevMentions = new Set(normalizeMentionMemberIds(m.mentionMemberIds));
            const nextMentions = normalizeMentionMemberIds(patch.mentionMemberIds);
            newlyMentioned = nextMentions.filter((mid) => !prevMentions.has(mid));
            updated = {
              ...m,
              bodyText: patch.bodyText,
              mentionMemberIds: nextMentions,
            };
            return {
              ...updated,
            };
          }),
        }));
        if (updated && newlyMentioned.length > 0) {
          dispatchNewMentionNotifications(updated, newlyMentioned);
        }
        return ok;
      },
      deleteMessage: (id) =>
        set((s) => ({ messages: s.messages.filter((m) => m.id !== id) })),
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
            messageBelongsToCurrentWorkspace(m) &&
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
      version: BLOCK_COMMENT_STORE_VERSION,
      migrate: migrateBlockCommentStore,
    },
  ),
);
