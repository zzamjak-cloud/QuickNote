import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { zustandStorage } from "../lib/storage/index";
import type { DatabasePanelState, ViewKind } from "../types/database";
import { emptyPanelState } from "../types/database";
import { parseDatabasePanelStateJson } from "../lib/schemas/panelStateSchema";
import { useWorkspaceStore } from "./workspaceStore";

type DatabaseViewPrefsState = {
  /** workspaceId::databaseId -> 구버전 로컬 DB 뷰 설정. 신규 DB 블록은 node attrs로 동기화한다. */
  panelStateByKey: Record<string, DatabasePanelState>;
  viewByKey: Record<string, ViewKind>;
};

type DatabaseViewPrefsActions = {
  getPanelState: (databaseId: string, fallbackJson?: string) => DatabasePanelState;
  patchPanelState: (
    databaseId: string,
    patch: Partial<DatabasePanelState>,
    fallbackJson?: string,
  ) => void;
  getView: (databaseId: string, fallback?: ViewKind) => ViewKind;
  setView: (databaseId: string, view: ViewKind) => void;
};

export type DatabaseViewPrefsStore = DatabaseViewPrefsState & DatabaseViewPrefsActions;

export const DATABASE_VIEW_PREFS_STORE_VERSION = 1;

function currentWorkspaceKeyPart(): string {
  return useWorkspaceStore.getState().currentWorkspaceId ?? "local";
}

function viewPrefsKey(databaseId: string): string {
  return `${currentWorkspaceKeyPart()}::${databaseId}`;
}

function coercePanelState(value: unknown): DatabasePanelState {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...emptyPanelState(), ...(value as Partial<DatabasePanelState>) };
  }
  return emptyPanelState();
}

export const useDatabaseViewPrefsStore = create<DatabaseViewPrefsStore>()(
  persist(
    (set, get) => ({
      panelStateByKey: {},
      viewByKey: {},
      getPanelState: (databaseId, fallbackJson) => {
        const key = viewPrefsKey(databaseId);
        const stored = get().panelStateByKey[key];
        if (stored) return coercePanelState(stored);
        return fallbackJson
          ? parseDatabasePanelStateJson(fallbackJson)
          : emptyPanelState();
      },
      getView: (databaseId, fallback = "table") => {
        const key = viewPrefsKey(databaseId);
        return get().viewByKey[key] ?? fallback;
      },
      setView: (databaseId, view) => {
        const key = viewPrefsKey(databaseId);
        set((state) => ({
          viewByKey: {
            ...state.viewByKey,
            [key]: view,
          },
        }));
      },
      patchPanelState: (databaseId, patch, fallbackJson) => {
        const key = viewPrefsKey(databaseId);
        set((state) => {
          const base =
            state.panelStateByKey[key] ??
            (fallbackJson
              ? parseDatabasePanelStateJson(fallbackJson)
              : emptyPanelState());
          return {
            panelStateByKey: {
              ...state.panelStateByKey,
              [key]: { ...coercePanelState(base), ...patch },
            },
          };
        });
      },
    }),
    {
      name: "quicknote.databaseViewPrefs.v1",
      storage: createJSONStorage(() => zustandStorage),
      version: DATABASE_VIEW_PREFS_STORE_VERSION,
      migrate: (persisted) => {
        const state =
          persisted && typeof persisted === "object" && !Array.isArray(persisted)
            ? (persisted as Partial<DatabaseViewPrefsState>)
            : {};
        return {
          panelStateByKey:
            state.panelStateByKey &&
            typeof state.panelStateByKey === "object" &&
            !Array.isArray(state.panelStateByKey)
              ? state.panelStateByKey
              : {},
          viewByKey:
            state.viewByKey &&
            typeof state.viewByKey === "object" &&
            !Array.isArray(state.viewByKey)
              ? state.viewByKey
              : {},
        };
      },
    },
  ),
);
