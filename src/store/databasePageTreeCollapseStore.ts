import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { zustandStorage } from "../lib/storage/index";
import { useWorkspaceStore } from "./workspaceStore";

type DatabasePageTreeCollapseState = {
  collapsedByKey: Record<string, boolean>;
};

type DatabasePageTreeCollapseActions = {
  isCollapsed: (databaseId: string, pageId: string) => boolean;
  setCollapsed: (databaseId: string, pageId: string, collapsed: boolean) => void;
  toggle: (databaseId: string, pageId: string) => void;
};

export type DatabasePageTreeCollapseStore = DatabasePageTreeCollapseState &
  DatabasePageTreeCollapseActions;

function workspaceKeyPart(): string {
  return useWorkspaceStore.getState().currentWorkspaceId ?? "local";
}

export function databasePageTreeCollapseKey(databaseId: string, pageId: string): string {
  return `${workspaceKeyPart()}::${databaseId}::${pageId}`;
}

export const useDatabasePageTreeCollapseStore = create<DatabasePageTreeCollapseStore>()(
  persist(
    (set, get) => ({
      collapsedByKey: {},
      isCollapsed: (databaseId, pageId) =>
        get().collapsedByKey[databasePageTreeCollapseKey(databaseId, pageId)] !== false,
      setCollapsed: (databaseId, pageId, collapsed) =>
        set((state) => {
          const key = databasePageTreeCollapseKey(databaseId, pageId);
          const next = { ...state.collapsedByKey };
          if (collapsed) delete next[key];
          else next[key] = false;
          return { collapsedByKey: next };
        }),
      toggle: (databaseId, pageId) => {
        const collapsed = get().isCollapsed(databaseId, pageId);
        get().setCollapsed(databaseId, pageId, !collapsed);
      },
    }),
    {
      name: "quicknote.database-page-tree-collapse.v1",
      storage: createJSONStorage(() => zustandStorage),
    },
  ),
);
