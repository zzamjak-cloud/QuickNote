import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { zustandStorage } from "../lib/storage/index";

type PageMetaRemoteState = {
  nextTokenByWorkspaceId: Record<string, string | null>;
  loadingByWorkspaceId: Record<string, boolean>;
};

type PageMetaRemoteActions = {
  setNextToken: (workspaceId: string, nextToken: string | null) => void;
  setLoading: (workspaceId: string, loading: boolean) => void;
  clearWorkspace: (workspaceId: string) => void;
  clear: () => void;
};

export type PageMetaRemoteStore = PageMetaRemoteState & PageMetaRemoteActions;

export const usePageMetaRemoteStore = create<PageMetaRemoteStore>()(
  persist(
    (set) => ({
      nextTokenByWorkspaceId: {},
      loadingByWorkspaceId: {},
      setNextToken: (workspaceId, nextToken) =>
        set((state) => ({
          nextTokenByWorkspaceId: {
            ...state.nextTokenByWorkspaceId,
            [workspaceId]: nextToken,
          },
        })),
      setLoading: (workspaceId, loading) =>
        set((state) => ({
          loadingByWorkspaceId: {
            ...state.loadingByWorkspaceId,
            [workspaceId]: loading,
          },
        })),
      clearWorkspace: (workspaceId) =>
        set((state) => {
          const nextTokenByWorkspaceId = { ...state.nextTokenByWorkspaceId };
          const loadingByWorkspaceId = { ...state.loadingByWorkspaceId };
          delete nextTokenByWorkspaceId[workspaceId];
          delete loadingByWorkspaceId[workspaceId];
          return { nextTokenByWorkspaceId, loadingByWorkspaceId };
        }),
      clear: () => set({ nextTokenByWorkspaceId: {}, loadingByWorkspaceId: {} }),
    }),
    {
      name: "quicknote.page-meta-remote.v1",
      storage: createJSONStorage(() => zustandStorage),
      partialize: (state) => ({ nextTokenByWorkspaceId: state.nextTokenByWorkspaceId }),
    },
  ),
);
