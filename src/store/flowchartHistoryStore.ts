// 플로우차트 버전 히스토리(로컬). flowchartId 별로 저장 시점 스냅샷을 누적한다.
// 연속 동일 스냅샷은 누적하지 않고, 자원당 최대 MAX_VERSIONS 개만 유지한다.
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { zustandStorage } from "../lib/storage/index";
import { newId } from "../lib/id";
import { serializeFlowchart, type FlowchartData } from "../types/flowchart";

const MAX_VERSIONS = 50;

export type FlowchartVersion = {
  id: string;
  createdAt: number;
  title: string;
  data: FlowchartData;
};

type FlowchartHistoryState = {
  /** flowchartId -> 최신순(앞이 최신) 버전 목록 */
  versions: Record<string, FlowchartVersion[]>;
};

type FlowchartHistoryActions = {
  /** 새 버전을 적립한다. 직전과 동일해 건너뛰면 false. */
  pushVersion: (
    flowchartId: string,
    title: string,
    data: FlowchartData,
  ) => boolean;
  clear: (flowchartId: string) => void;
};

export type FlowchartHistoryStore = FlowchartHistoryState &
  FlowchartHistoryActions;

function now(): number {
  return Date.now();
}

export const useFlowchartHistoryStore = create<FlowchartHistoryStore>()(
  persist(
    (set, get) => ({
      versions: {},

      pushVersion: (flowchartId, title, data) => {
        if (!flowchartId) return false;
        const list = get().versions[flowchartId] ?? [];
        const serialized = serializeFlowchart(data);
        // 직전 버전과 내용이 같으면 누적하지 않는다.
        if (list[0] && serializeFlowchart(list[0].data) === serialized) return false;
        const version: FlowchartVersion = {
          id: newId(),
          createdAt: now(),
          title,
          data,
        };
        const next = [version, ...list].slice(0, MAX_VERSIONS);
        set((state) => ({
          versions: { ...state.versions, [flowchartId]: next },
        }));
        return true;
      },

      clear: (flowchartId) =>
        set((state) => {
          const next = { ...state.versions };
          delete next[flowchartId];
          return { versions: next };
        }),
    }),
    {
      name: "quicknote.flowchart-history.v1",
      storage: createJSONStorage(() => zustandStorage),
    },
  ),
);
