import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { JSONContent } from "@tiptap/react";
import type { Page, PageMap } from "../types/page";
import { newId } from "../lib/id";

const EMPTY_DOC: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

type PageStoreState = {
  pages: PageMap;
  activePageId: string | null;
};

type PageStoreActions = {
  createPage: (title?: string, parentId?: string | null) => string;
  deletePage: (id: string) => void;
  renamePage: (id: string, title: string) => void;
  updateDoc: (id: string, doc: JSONContent) => void;
  setActivePage: (id: string | null) => void;
  reorderPages: (orderedIds: string[]) => void;
  setIcon: (id: string, icon: string | null) => void;
};

export type PageStore = PageStoreState & PageStoreActions;

function nextOrder(pages: PageMap): number {
  const orders = Object.values(pages).map((p) => p.order);
  return orders.length === 0 ? 0 : Math.max(...orders) + 1;
}

export const usePageStore = create<PageStore>()(
  persist(
    (set, get) => ({
      pages: {},
      activePageId: null,

      createPage: (title = "새 페이지", parentId = null) => {
        const id = newId();
        const now = Date.now();
        const page: Page = {
          id,
          title,
          icon: null,
          doc: structuredClone(EMPTY_DOC),
          parentId,
          order: nextOrder(get().pages),
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({
          pages: { ...state.pages, [id]: page },
          activePageId: id,
        }));
        return id;
      },

      deletePage: (id) => {
        set((state) => {
          if (!(id in state.pages)) return state;
          const { [id]: _removed, ...rest } = state.pages;
          let nextActive = state.activePageId;
          if (state.activePageId === id) {
            const remaining = Object.values(rest).sort(
              (a, b) => a.order - b.order,
            );
            nextActive = remaining[0]?.id ?? null;
          }
          return { pages: rest, activePageId: nextActive };
        });
      },

      renamePage: (id, title) => {
        set((state) => {
          const current = state.pages[id];
          if (!current) return state;
          return {
            pages: {
              ...state.pages,
              [id]: { ...current, title, updatedAt: Date.now() },
            },
          };
        });
      },

      updateDoc: (id, doc) => {
        set((state) => {
          const current = state.pages[id];
          if (!current) return state;
          return {
            pages: {
              ...state.pages,
              [id]: { ...current, doc, updatedAt: Date.now() },
            },
          };
        });
      },

      setActivePage: (id) => set({ activePageId: id }),

      reorderPages: (orderedIds) => {
        set((state) => {
          const next: PageMap = { ...state.pages };
          orderedIds.forEach((id, idx) => {
            const page = next[id];
            if (page) next[id] = { ...page, order: idx };
          });
          return { pages: next };
        });
      },

      setIcon: (id, icon) => {
        set((state) => {
          const current = state.pages[id];
          if (!current) return state;
          return {
            pages: {
              ...state.pages,
              [id]: { ...current, icon, updatedAt: Date.now() },
            },
          };
        });
      },
    }),
    {
      name: "quicknote.pageStore.v1",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export function selectSortedPages(state: PageStore): Page[] {
  return Object.values(state.pages).sort((a, b) => a.order - b.order);
}
