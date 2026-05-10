import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { zustandStorage } from "../lib/storage/index";
import { newId } from "../lib/id";
import { normalizeMentionMemberId } from "../lib/comments/mentionMemberIds";
import { useWorkspaceStore } from "./workspaceStore";
import type { PersistedObject } from "../lib/migrations/persistedStore";
import { migratePersistedStore } from "../lib/migrations/persistedStore";

/** 워크스페이스 멤버별 인앱 알림 */
export type InAppNotification = {
  id: string;
  recipientMemberId: string;
  kind: "mention" | "thread_reply";
  source?: "comment" | "page";
  workspaceId?: string | null;
  workspaceName?: string | null;
  pageTitle?: string | null;
  pageId: string;
  blockId: string;
  fromMemberId: string;
  commentId: string;
  previewBody: string;
  createdAt: number;
  read: boolean;
};

type NotificationState = {
  items: InAppNotification[];
};

type NotificationActions = {
  addNotification: (input: Omit<InAppNotification, "id" | "createdAt" | "read">) => void;
  removeNotification: (id: string) => void;
  removeNotificationByCommentId: (commentId: string) => void;
  updateNotificationByCommentId: (
    commentId: string,
    patch: Partial<Pick<InAppNotification, "previewBody" | "pageTitle" | "workspaceName">>,
  ) => void;
  markRead: (id: string) => void;
  markAllReadForMember: (memberId: string) => void;
  clearAllForMember: (memberId: string) => void;
  listForMember: (memberId: string) => InAppNotification[];
  unreadCountForMember: (memberId: string) => number;
};

export const NOTIFICATION_STORE_VERSION = 2;

function migrateNotificationItem(value: unknown): InAppNotification | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<InAppNotification>;
  if (
    typeof item.id !== "string" ||
    typeof item.recipientMemberId !== "string" ||
    typeof item.kind !== "string" ||
    typeof item.pageId !== "string" ||
    typeof item.blockId !== "string" ||
    typeof item.fromMemberId !== "string" ||
    typeof item.commentId !== "string"
  ) {
    return null;
  }
  return {
    id: item.id,
    recipientMemberId:
      normalizeMentionMemberId(item.recipientMemberId) ?? item.recipientMemberId,
    kind: item.kind === "thread_reply" ? "thread_reply" : "mention",
    source: item.source === "page" ? "page" : "comment",
    workspaceId: item.workspaceId ?? null,
    workspaceName: item.workspaceName ?? null,
    pageTitle: item.pageTitle ?? null,
    pageId: item.pageId,
    blockId: item.blockId,
    fromMemberId: normalizeMentionMemberId(item.fromMemberId) ?? item.fromMemberId,
    commentId: item.commentId,
    previewBody: typeof item.previewBody === "string" ? item.previewBody : "",
    createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
    read: Boolean(item.read),
  };
}

export function migrateNotificationStore(
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
          items: Array.isArray(state.items)
            ? state.items.map(migrateNotificationItem).filter(Boolean)
            : [],
        }),
      },
    ],
    { items: [] },
  );
}

export const useNotificationStore = create<NotificationState & NotificationActions>()(
  persist(
    (set, get) => ({
      items: [],
      addNotification: (input) => {
        const recipientMemberId =
          normalizeMentionMemberId(input.recipientMemberId) ??
          input.recipientMemberId;
        const fromMemberId =
          normalizeMentionMemberId(input.fromMemberId) ?? input.fromMemberId;
        const workspaceId =
          input.workspaceId ?? useWorkspaceStore.getState().currentWorkspaceId;
        const alreadyExists = get().items.some(
          (x) =>
            normalizeMentionMemberId(x.recipientMemberId) === recipientMemberId &&
            x.kind === input.kind &&
            x.commentId === input.commentId &&
            (x.workspaceId ?? null) === (workspaceId ?? null),
        );
        if (alreadyExists) return;
        const n: InAppNotification = {
          id: newId(),
          recipientMemberId,
          kind: input.kind,
          source: input.source,
          workspaceId,
          workspaceName:
            input.workspaceName ??
            useWorkspaceStore
              .getState()
              .workspaces.find(
                (w) =>
                  w.workspaceId ===
                  workspaceId,
              )?.name ??
            null,
          pageTitle: input.pageTitle ?? null,
          pageId: input.pageId,
          blockId: input.blockId,
          fromMemberId,
          commentId: input.commentId,
          previewBody: input.previewBody,
          createdAt: Date.now(),
          read: false,
        };
        set((s) => ({ items: [n, ...s.items].slice(0, 500) }));
      },
      removeNotification: (id) =>
        set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
      removeNotificationByCommentId: (commentId) =>
        set((s) => ({
          items: s.items.filter((x) => x.commentId !== commentId),
        })),
      updateNotificationByCommentId: (commentId, patch) =>
        set((s) => ({
          items: s.items.map((x) =>
            x.commentId === commentId ? { ...x, ...patch } : x,
          ),
        })),
      markRead: (id) =>
        set((s) => ({
          items: s.items.map((x) => (x.id === id ? { ...x, read: true } : x)),
        })),
      markAllReadForMember: (memberId) =>
        set((s) => ({
          items: s.items.map((x) =>
            normalizeMentionMemberId(x.recipientMemberId) === memberId
              ? { ...x, read: true }
              : x,
          ),
        })),
      clearAllForMember: (memberId) =>
        set((s) => ({
          items: s.items.filter(
            (x) => normalizeMentionMemberId(x.recipientMemberId) !== memberId,
          ),
        })),
      listForMember: (memberId) =>
        get()
          .items.filter(
            (x) => normalizeMentionMemberId(x.recipientMemberId) === memberId,
          )
          .sort((a, b) => b.createdAt - a.createdAt),
      unreadCountForMember: (memberId) =>
        get().items.filter(
          (x) =>
            normalizeMentionMemberId(x.recipientMemberId) === memberId &&
            !x.read,
        ).length,
    }),
    {
      name: "quicknote.notifications.v1",
      storage: createJSONStorage(() => zustandStorage),
      version: NOTIFICATION_STORE_VERSION,
      migrate: migrateNotificationStore,
    },
  ),
);
