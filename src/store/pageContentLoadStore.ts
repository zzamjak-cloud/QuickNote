import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { zustandStorage } from "../lib/storage/index";

type PageContentLoadState = {
  metaOnlyByPageId: Record<string, true>;
  loadingByPageId: Record<string, boolean>;
};

type PageContentLoadActions = {
  markMetaOnly: (pageIds: string[]) => void;
  markLoaded: (pageIds: string[]) => void;
  setLoading: (pageId: string, loading: boolean) => void;
  clear: () => void;
};

export type PageContentLoadStore = PageContentLoadState & PageContentLoadActions;

export const usePageContentLoadStore = create<PageContentLoadStore>()(
  persist(
    (set) => ({
      metaOnlyByPageId: {},
      loadingByPageId: {},
      markMetaOnly: (pageIds) =>
        set((state) => {
          if (pageIds.length === 0) return state;
          const next = { ...state.metaOnlyByPageId };
          for (const pageId of pageIds) next[pageId] = true;
          return { metaOnlyByPageId: next };
        }),
      markLoaded: (pageIds) =>
        set((state) => {
          if (pageIds.length === 0) return state;
          const metaOnlyByPageId = { ...state.metaOnlyByPageId };
          const loadingByPageId = { ...state.loadingByPageId };
          for (const pageId of pageIds) {
            delete metaOnlyByPageId[pageId];
            delete loadingByPageId[pageId];
          }
          return { metaOnlyByPageId, loadingByPageId };
        }),
      setLoading: (pageId, loading) =>
        set((state) => ({
          loadingByPageId: {
            ...state.loadingByPageId,
            [pageId]: loading,
          },
        })),
      clear: () => set({ metaOnlyByPageId: {}, loadingByPageId: {} }),
    }),
    {
      name: "quicknote.page-content-load.v1",
      storage: createJSONStorage(() => zustandStorage),
      partialize: (state) => ({ metaOnlyByPageId: state.metaOnlyByPageId }),
    },
  ),
);
