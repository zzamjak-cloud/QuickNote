import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { zustandStorage } from "../lib/storage/index";
import { newId } from "../lib/id";

/** 워크스페이스 멤버별 인앱 알림 */
export type InAppNotification = {
  id: string;
  recipientMemberId: string;
  kind: "mention" | "thread_reply";
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
  markRead: (id: string) => void;
  markAllReadForMember: (memberId: string) => void;
  clearAllForMember: (memberId: string) => void;
  listForMember: (memberId: string) => InAppNotification[];
  unreadCountForMember: (memberId: string) => number;
};

export const useNotificationStore = create<NotificationState & NotificationActions>()(
  persist(
    (set, get) => ({
      items: [],
      addNotification: (input) => {
        const n: InAppNotification = {
          id: newId(),
          recipientMemberId: input.recipientMemberId,
          kind: input.kind,
          pageId: input.pageId,
          blockId: input.blockId,
          fromMemberId: input.fromMemberId,
          commentId: input.commentId,
          previewBody: input.previewBody,
          createdAt: Date.now(),
          read: false,
        };
        set((s) => ({ items: [n, ...s.items].slice(0, 500) }));
      },
      removeNotification: (id) =>
        set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
      markRead: (id) =>
        set((s) => ({
          items: s.items.map((x) => (x.id === id ? { ...x, read: true } : x)),
        })),
      markAllReadForMember: (memberId) =>
        set((s) => ({
          items: s.items.map((x) =>
            x.recipientMemberId === memberId ? { ...x, read: true } : x,
          ),
        })),
      clearAllForMember: (memberId) =>
        set((s) => ({
          items: s.items.filter((x) => x.recipientMemberId !== memberId),
        })),
      listForMember: (memberId) =>
        get()
          .items.filter((x) => x.recipientMemberId === memberId)
          .sort((a, b) => b.createdAt - a.createdAt),
      unreadCountForMember: (memberId) =>
        get().items.filter((x) => x.recipientMemberId === memberId && !x.read)
          .length,
    }),
    {
      name: "quicknote.notifications.v1",
      storage: createJSONStorage(() => zustandStorage),
      version: 1,
    },
  ),
);
