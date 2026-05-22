import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { webStorage } from "../lib/storage/web";
import type { WorkspaceAccessInput } from "../lib/sync/workspaceApi";

type State = {
  cache: Record<string, WorkspaceAccessInput[]>;
};

type Actions = {
  setCache: (workspaceId: string, entries: WorkspaceAccessInput[]) => void;
  clearCache: (workspaceId: string) => void;
};

export const useWorkspaceAccessCacheStore = create<State & Actions>()(
  persist(
    (set) => ({
      cache: {},
      setCache: (workspaceId, entries) =>
        set((s) => ({ cache: { ...s.cache, [workspaceId]: entries } })),
      clearCache: (workspaceId) =>
        set((s) => {
          const next = { ...s.cache };
          delete next[workspaceId];
          return { cache: next };
        }),
    }),
    {
      name: "quicknote.workspace.access.cache.v1",
      storage: createJSONStorage(() => webStorage),
    },
  ),
);
