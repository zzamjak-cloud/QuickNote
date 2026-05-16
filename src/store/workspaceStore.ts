import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  LC_SCHEDULER_WORKSPACE_ID,
  LC_SCHEDULER_WORKSPACE_NAME,
} from "../lib/scheduler/scope";

export type WorkspaceAccessLevel = "edit" | "view";
export type WorkspaceType = "personal" | "shared";

export type WorkspaceSummary = {
  workspaceId: string;
  name: string;
  type: WorkspaceType;
  ownerMemberId: string;
  myEffectiveLevel: WorkspaceAccessLevel;
  createdAt?: string;
  removedAt?: string;
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

export const LC_SCHEDULER_WORKSPACE_SUMMARY: WorkspaceSummary = {
  workspaceId: LC_SCHEDULER_WORKSPACE_ID,
  name: LC_SCHEDULER_WORKSPACE_NAME,
  type: "shared",
  ownerMemberId: "system",
  myEffectiveLevel: "edit",
};

function withLCSchedulerWorkspace(workspaces: WorkspaceSummary[]): WorkspaceSummary[] {
  const active = workspaces.filter((workspace) => workspace.workspaceId !== LC_SCHEDULER_WORKSPACE_ID);
  return [LC_SCHEDULER_WORKSPACE_SUMMARY, ...active];
}

function defaultWorkspaceId(workspaces: WorkspaceSummary[]): string | null {
  return workspaces.find((workspace) => workspace.workspaceId !== LC_SCHEDULER_WORKSPACE_ID)?.workspaceId
    ?? workspaces[0]?.workspaceId
    ?? null;
}

const LAST_WORKSPACE_ID_KEY = "quicknote.workspace.lastVisited.v1";

function readLastWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LAST_WORKSPACE_ID_KEY);
}

function writeLastWorkspaceId(workspaceId: string | null): void {
  if (typeof window === "undefined" || !workspaceId) return;
  window.localStorage.setItem(LAST_WORKSPACE_ID_KEY, workspaceId);
}

function fallbackWorkspaceId(workspaces: WorkspaceSummary[]): string | null {
  const lastWorkspaceId = readLastWorkspaceId();
  if (lastWorkspaceId && workspaces.some((workspace) => workspace.workspaceId === lastWorkspaceId)) {
    return lastWorkspaceId;
  }
  return defaultWorkspaceId(workspaces);
}

const tabWorkspaceStorage = {
  getItem: (key: string): string | null => {
    if (typeof window === "undefined") return null;
    return window.sessionStorage.getItem(key);
  },
  setItem: (key: string, value: string): void => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(key, value);
  },
  removeItem: (key: string): void => {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(key);
  },
};

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set) => ({
      currentWorkspaceId: null,
      workspaces: [],

      setCurrentWorkspaceId: (workspaceId) => {
        writeLastWorkspaceId(workspaceId);
        set({ currentWorkspaceId: workspaceId });
      },

      setWorkspaces: (workspaces) =>
        set((state) => {
          const nextWorkspaces = withLCSchedulerWorkspace(workspaces);
          // 빈 배열이면 기존 유지 — API 일시 실패·레이스로 선택 WS 가 첫 항목으로 덮이는 것 방지
          if (workspaces.length === 0 && state.workspaces.length > 0) {
            return state;
          }
          const currentExists =
            state.currentWorkspaceId !== null &&
            nextWorkspaces.some((w) => w.workspaceId === state.currentWorkspaceId);
          return {
            workspaces: nextWorkspaces,
            currentWorkspaceId:
              currentExists
                ? state.currentWorkspaceId
                : fallbackWorkspaceId(nextWorkspaces),
          };
        }),

      upsertWorkspace: (workspace) =>
        set((state) => {
          const nextWorkspace = workspace.workspaceId === LC_SCHEDULER_WORKSPACE_ID
            ? LC_SCHEDULER_WORKSPACE_SUMMARY
            : workspace;
          const exists = state.workspaces.some((w) => w.workspaceId === nextWorkspace.workspaceId);
          const workspaces = withLCSchedulerWorkspace(exists
            ? state.workspaces.map((w) =>
                w.workspaceId === nextWorkspace.workspaceId ? nextWorkspace : w,
              )
            : [...state.workspaces, nextWorkspace]);
          return {
            workspaces,
            currentWorkspaceId:
              state.currentWorkspaceId ?? fallbackWorkspaceId(workspaces),
          };
        }),

      removeWorkspace: (workspaceId) =>
        set((state) => {
          if (workspaceId === LC_SCHEDULER_WORKSPACE_ID) return state;
          const workspaces = state.workspaces.filter((w) => w.workspaceId !== workspaceId);
          const currentWorkspaceId =
            state.currentWorkspaceId === workspaceId
              ? fallbackWorkspaceId(workspaces)
              : state.currentWorkspaceId;
          return { workspaces, currentWorkspaceId };
        }),

      clear: () => set({ currentWorkspaceId: null, workspaces: [] }),
    }),
    {
      name: "quicknote.workspace.session.v1",
      storage: createJSONStorage(() => tabWorkspaceStorage),
      partialize: (state) => ({ currentWorkspaceId: state.currentWorkspaceId }),
    },
  ),
);
