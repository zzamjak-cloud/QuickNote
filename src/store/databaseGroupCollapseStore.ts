import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { zustandStorage } from "../lib/storage/index";
import type { ViewKind } from "../types/database";
import { useWorkspaceStore } from "./workspaceStore";

// 데이터베이스 그룹화 접힘(폴딩) 상태 — 개인 로컬 UI 상태이므로 서버 동기화하지 않는다.
// (동기화 대상은 그룹화 설정값 groupByColumnId 뿐. 접힘은 panelState 에 넣지 않는다.)
// 키: `${workspaceId}::${databaseId}::${viewKind}::${groupKey}` -> collapsed(true)
// 기본값은 펼침이므로 collapsed=true 인 항목만 저장한다(부재 = 펼침).

type DatabaseGroupCollapseState = {
  collapsedByKey: Record<string, boolean>;
};

type DatabaseGroupCollapseActions = {
  isCollapsed: (databaseId: string, viewKind: ViewKind, groupKey: string) => boolean;
  toggle: (databaseId: string, viewKind: ViewKind, groupKey: string) => void;
  setCollapsed: (
    databaseId: string,
    viewKind: ViewKind,
    groupKey: string,
    collapsed: boolean,
  ) => void;
};

export type DatabaseGroupCollapseStore = DatabaseGroupCollapseState &
  DatabaseGroupCollapseActions;

function workspaceKeyPart(): string {
  return useWorkspaceStore.getState().currentWorkspaceId ?? "local";
}

function collapseKey(databaseId: string, viewKind: ViewKind, groupKey: string): string {
  return `${workspaceKeyPart()}::${databaseId}::${viewKind}::${groupKey}`;
}

export const useDatabaseGroupCollapseStore = create<DatabaseGroupCollapseStore>()(
  persist(
    (set, get) => ({
      collapsedByKey: {},
      isCollapsed: (databaseId, viewKind, groupKey) =>
        get().collapsedByKey[collapseKey(databaseId, viewKind, groupKey)] === true,
      setCollapsed: (databaseId, viewKind, groupKey, collapsed) =>
        set((state) => {
          const key = collapseKey(databaseId, viewKind, groupKey);
          const next = { ...state.collapsedByKey };
          if (collapsed) next[key] = true;
          else delete next[key]; // 펼침은 부재로 표현(저장 최소화)
          return { collapsedByKey: next };
        }),
      toggle: (databaseId, viewKind, groupKey) => {
        const collapsed = get().isCollapsed(databaseId, viewKind, groupKey);
        get().setCollapsed(databaseId, viewKind, groupKey, !collapsed);
      },
    }),
    {
      name: "quicknote.database-group-collapse.v1",
      storage: createJSONStorage(() => zustandStorage),
    },
  ),
);
