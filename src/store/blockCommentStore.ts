/**
 * 블록 댓글의 저장 위치는 `usePageStore.pages[*].blockComments` 이며,
 * AppSync `Page.blockComments`(AWSJSON) 및 upsert outbox 와 동기화된다.
 * 이 스토어는 페이지 맵을 집계해 기존 UI 헬퍼(messagesForBlock 등)를 유지한다.
 */
import { create } from "zustand";
import { newId } from "../lib/id";
import type { BlockCommentMsg } from "../types/blockComment";
import { usePageStore } from "./pageStore";
import { useWorkspaceStore } from "./workspaceStore";
import { normalizeMentionMemberIds } from "../lib/comments/mentionMemberIds";
import {
  dispatchNewMentionNotificationsForComment,
  dispatchNotificationsForBlockCommentMessage,
} from "../lib/comments/blockCommentNotifications";
import { priorParticipantIdsForNewMessage } from "../lib/comments/blockCommentSnapshot";
import type { Page } from "../types/page";
import type { PersistedObject } from "../lib/migrations/persistedStore";
import { migratePersistedStore } from "../lib/migrations/persistedStore";
import { migrateBlockCommentMsg, migrateThreadVisitedAt } from "../lib/comments/blockCommentSnapshot";

export type { BlockCommentMsg } from "../types/blockComment";

const PAGE_SUB_GUARD_KEY = "__qnBlockCommentPageSubscribed";

/** doc 만 바뀐 경우 집계 시그니처는 동일 → blockCommentStore 불필요 갱신 생략 */
function serializeBlockCommentAggregateSig(agg: {
  messages: BlockCommentMsg[];
  threadVisitedAt: Record<string, number>;
}): string {
  const msgPart = agg.messages
    .map(
      (m) =>
        `${m.id}\t${m.pageId}\t${m.blockId}\t${m.createdAt}\t${m.bodyText}\t${m.mentionMemberIds.join(",")}`,
    )
    .sort()
    .join("\n");
  const tvPart = Object.entries(agg.threadVisitedAt)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("|");
  return `${msgPart}~~${tvPart}`;
}

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

function aggregateFromPages(pages: Record<string, Page>): {
  messages: BlockCommentMsg[];
  threadVisitedAt: Record<string, number>;
} {
  const messages: BlockCommentMsg[] = [];
  const threadVisitedAt: Record<string, number> = {};
  for (const page of Object.values(pages)) {
    const bc = page.blockComments;
    if (!bc) continue;
    for (const m of bc.messages) {
      messages.push(m);
    }
    for (const [blockId, t] of Object.entries(bc.threadVisitedAt ?? {})) {
      const k = threadKey(page.id, blockId);
      threadVisitedAt[k] = Math.max(threadVisitedAt[k] ?? 0, t);
    }
  }
  return { messages, threadVisitedAt };
}

type BlockCommentState = {
  messages: BlockCommentMsg[];
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
  /** 페이지 스토어 변경 후 집계를 강제 갱신(테스트·마이그레이션용) */
  resyncFromPages: () => void;
};

export const BLOCK_COMMENT_STORE_VERSION = 2;

/** 레거시 persist 마이그레이션 단위 테스트용 — 런타임 persist 는 제거됨 */
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

export const useBlockCommentStore = create<BlockCommentState & BlockCommentActions>()((set, get) => {
  const syncFromPages = (): void => {
    set(aggregateFromPages(usePageStore.getState().pages));
  };

  if (typeof window !== "undefined") {
    queueMicrotask(() => {
      syncFromPages();
      const g = globalThis as Record<string, unknown>;
      if (!g[PAGE_SUB_GUARD_KEY]) {
        g[PAGE_SUB_GUARD_KEY] = true;
        let lastSig = serializeBlockCommentAggregateSig(
          aggregateFromPages(usePageStore.getState().pages),
        );
        usePageStore.subscribe((s) => {
          const next = aggregateFromPages(s.pages);
          const sig = serializeBlockCommentAggregateSig(next);
          if (sig === lastSig) return;
          lastSig = sig;
          set(next);
        });
      }
    });
  }

  return {
    messages: [],
    threadVisitedAt: {},
    resyncFromPages: syncFromPages,

    addMessage: (input) => {
      const page = usePageStore.getState().pages[input.pageId];
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
      const prior = priorParticipantIdsForNewMessage(
        page?.blockComments?.messages ?? [],
        input.pageId,
        input.blockId,
        msg,
      );
      usePageStore.getState().appendPageBlockComment(input.pageId, msg);
      dispatchNotificationsForBlockCommentMessage(msg, prior);
      return msg;
    },

    updateMessage: (id, patch) => {
      const pages = usePageStore.getState().pages;
      let pageId: string | null = null;
      let prev: BlockCommentMsg | null = null;
      for (const p of Object.values(pages)) {
        const hit = p.blockComments?.messages.find((m) => m.id === id);
        if (hit) {
          pageId = p.id;
          prev = hit;
          break;
        }
      }
      if (!pageId || !prev) return false;
      const prevMentions = new Set(normalizeMentionMemberIds(prev.mentionMemberIds));
      const nextMentions = normalizeMentionMemberIds(patch.mentionMemberIds);
      const newlyMentioned = nextMentions.filter((mid) => !prevMentions.has(mid));
      usePageStore.getState().updatePageBlockComment(pageId, id, patch);
      const updated: BlockCommentMsg = {
        ...prev,
        bodyText: patch.bodyText,
        mentionMemberIds: nextMentions,
      };
      if (newlyMentioned.length > 0) {
        dispatchNewMentionNotificationsForComment(updated, newlyMentioned);
      }
      return true;
    },

    deleteMessage: (id) => {
      for (const p of Object.values(usePageStore.getState().pages)) {
        if (p.blockComments?.messages.some((m) => m.id === id)) {
          usePageStore.getState().deletePageBlockComment(p.id, id);
          return;
        }
      }
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
      usePageStore.getState().markPageBlockCommentThreadVisited(pageId, blockId);
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
  };
});
