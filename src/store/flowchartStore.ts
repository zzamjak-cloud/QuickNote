// 플로우차트 공유 저장소. 블록 attrs 의 flowchartId 로 데이터를 참조한다.
// 같은 flowchartId 를 쓰는 모든 블록(복제본 포함)이 이 저장소를 구독해 동기화된다.
// 서버 동기화(upsert/list)는 sync 레이어가 applyRemote/구독으로 연결한다.
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { zustandStorage } from "../lib/storage/index";
import {
  emptyFlowchart,
  serializeFlowchart,
  type FlowchartData,
  type FlowchartRecord,
} from "../types/flowchart";

type FlowchartState = {
  records: Record<string, FlowchartRecord>;
};

type FlowchartActions = {
  /** 로컬 편집 반영 — updatedAt 을 현재 시각으로 올린다. (서버 push 는 sync 레이어가 수행) */
  upsertLocal: (input: {
    id: string;
    workspaceId: string | null;
    title: string;
    data: FlowchartData;
  }) => FlowchartRecord;
  /** 서버/타 기기 변경 반영 — updatedAt 이 더 최신일 때만 덮어쓴다(LWW). */
  applyRemote: (record: FlowchartRecord) => void;
  /** 인라인 데이터에서 최초 1회 레코드를 만든다(이미 있으면 무시). */
  seedIfAbsent: (input: {
    id: string;
    workspaceId: string | null;
    title: string;
    data: FlowchartData;
  }) => void;
};

export type FlowchartStore = FlowchartState & FlowchartActions;

// Date.now 는 앱 코드에서 사용 가능(워크플로 스크립트에서만 금지).
function now(): number {
  return Date.now();
}

export const useFlowchartStore = create<FlowchartStore>()(
  persist(
    (set, get) => ({
      records: {},

      upsertLocal: ({ id, workspaceId, title, data }) => {
        const record: FlowchartRecord = {
          id,
          workspaceId,
          title,
          data,
          updatedAt: now(),
          deletedAt: null,
        };
        set((state) => ({ records: { ...state.records, [id]: record } }));
        return record;
      },

      applyRemote: (record) => {
        const existing = get().records[record.id];
        if (existing) {
          // 더 오래된 변경은 무시.
          if (existing.updatedAt > record.updatedAt) return;
          // 내용이 동일하면 갱신하지 않는다 — 페이지를 열 때마다 서버에서 같은 값을
          // 받아 레코드를 교체하면 구독 컴포넌트가 불필요하게 리마운트되어 "튕김"이 생긴다.
          const sameData =
            serializeFlowchart(existing.data) === serializeFlowchart(record.data);
          const sameDeleted = (existing.deletedAt ?? null) === (record.deletedAt ?? null);
          if (sameData && sameDeleted) return;
        }
        set((state) => ({ records: { ...state.records, [record.id]: record } }));
      },

      seedIfAbsent: ({ id, workspaceId, title, data }) => {
        if (get().records[id]) return;
        set((state) => ({
          records: {
            ...state.records,
            [id]: { id, workspaceId, title, data, updatedAt: now(), deletedAt: null },
          },
        }));
      },
    }),
    {
      name: "quicknote.flowcharts.v1",
      storage: createJSONStorage(() => zustandStorage),
    },
  ),
);

/** 셀렉터 외부에서 단건 조회가 필요할 때. */
export function getFlowchartData(id: string): FlowchartData | undefined {
  const rec = useFlowchartStore.getState().records[id];
  return rec && !rec.deletedAt ? rec.data : undefined;
}

export { emptyFlowchart };
