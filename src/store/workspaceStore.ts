import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { zustandStorage } from "../lib/storage/index";

export type WorkspaceAccessLevel = "edit" | "view";
export type WorkspaceType = "personal" | "shared";

export type WorkspaceSummary = {
  workspaceId: string;
  name: string;
  type: WorkspaceType;
  ownerMemberId: string;
  myEffectiveLevel: WorkspaceAccessLevel;
  createdAt?: string;
};

type WorkspaceStoreState = {
  currentWorkspaceId: string | null;
  workspaces: WorkspaceSummary[];
};

type WorkspaceStoreActions = {
  setCurrentWorkspaceId: (workspaceId: string | null) => void;
  setWorkspaces: (workspaces: WorkspaceSummary[]) => void;
  upsertWorkspace: (workspace: WorkspaceSummary) => void;
  removeWorkspace: (workspaceId: string) => void;
  clear: () => void;
};

export type WorkspaceStore = WorkspaceStoreState & WorkspaceStoreActions;

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set) => ({
      currentWorkspaceId: null,
      workspaces: [],

      setCurrentWorkspaceId: (workspaceId) => set({ currentWorkspaceId: workspaceId }),

      setWorkspaces: (workspaces) =>
        set((state) => {
          const currentExists =
            state.currentWorkspaceId !== null &&
            workspaces.some((w) => w.workspaceId === state.currentWorkspaceId);
          return {
            workspaces,
            currentWorkspaceId:
              currentExists
                ? state.currentWorkspaceId
                : (workspaces[0]?.workspaceId ?? null),
          };
        }),

      upsertWorkspace: (workspace) =>
        set((state) => {
          const exists = state.workspaces.some((w) => w.workspaceId === workspace.workspaceId);
          const workspaces = exists
            ? state.workspaces.map((w) =>
                w.workspaceId === workspace.workspaceId ? workspace : w,
              )
            : [...state.workspaces, workspace];
          return {
            workspaces,
            currentWorkspaceId:
              state.currentWorkspaceId ?? workspace.workspaceId,
          };
        }),

      removeWorkspace: (workspaceId) =>
        set((state) => {
          const workspaces = state.workspaces.filter((w) => w.workspaceId !== workspaceId);
          const currentWorkspaceId =
            state.currentWorkspaceId === workspaceId
              ? (workspaces[0]?.workspaceId ?? null)
              : state.currentWorkspaceId;
          return { workspaces, currentWorkspaceId };
        }),

      clear: () => set({ currentWorkspaceId: null, workspaces: [] }),
    }),
    {
      name: "quicknote.workspace.v1",
      storage: createJSONStorage(() => zustandStorage),
      partialize: (state) => ({ currentWorkspaceId: state.currentWorkspaceId }),
    },
  ),
);
