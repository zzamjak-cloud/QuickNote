import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { zustandStorage } from "../lib/storage/index";

type DatabaseRowRemoteState = {
  nextTokenByDatabaseId: Record<string, string | null>;
  loadingByDatabaseId: Record<string, boolean>;
};

type DatabaseRowRemoteActions = {
  setNextToken: (databaseId: string, nextToken: string | null) => void;
  setLoading: (databaseId: string, loading: boolean) => void;
  clearDatabase: (databaseId: string) => void;
  clear: () => void;
};

export type DatabaseRowRemoteStore = DatabaseRowRemoteState & DatabaseRowRemoteActions;

export const useDatabaseRowRemoteStore = create<DatabaseRowRemoteStore>()(
  persist(
    (set) => ({
      nextTokenByDatabaseId: {},
      loadingByDatabaseId: {},
      setNextToken: (databaseId, nextToken) =>
        set((state) => ({
          nextTokenByDatabaseId: {
            ...state.nextTokenByDatabaseId,
            [databaseId]: nextToken,
          },
        })),
      setLoading: (databaseId, loading) =>
        set((state) => ({
          loadingByDatabaseId: {
            ...state.loadingByDatabaseId,
            [databaseId]: loading,
          },
        })),
      clearDatabase: (databaseId) =>
        set((state) => {
          const nextTokenByDatabaseId = { ...state.nextTokenByDatabaseId };
          const loadingByDatabaseId = { ...state.loadingByDatabaseId };
          delete nextTokenByDatabaseId[databaseId];
          delete loadingByDatabaseId[databaseId];
          return { nextTokenByDatabaseId, loadingByDatabaseId };
        }),
      clear: () => set({ nextTokenByDatabaseId: {}, loadingByDatabaseId: {} }),
    }),
    {
      name: "quicknote.database-row-remote.v1",
      storage: createJSONStorage(() => zustandStorage),
      partialize: (state) => ({ nextTokenByDatabaseId: state.nextTokenByDatabaseId }),
    },
  ),
);
