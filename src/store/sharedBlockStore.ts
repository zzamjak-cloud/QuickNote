// 드롭다운 메뉴·갤러리 블록의 공유 저장소.
// 같은 sharedBlockId 를 쓰는 모든 복제본은 이 레코드를 구독해 즉시 동기화된다.
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { zustandStorage } from "../lib/storage/index";
import type {
  SharedBlockData,
  SharedBlockKind,
  SharedBlockRecord,
} from "../types/sharedBlock";

type SharedBlockState = {
  records: Record<string, SharedBlockRecord>;
};

type SharedBlockActions = {
  /** 현재 workspace/id 슬롯에 더 최신 원격 레코드가 반영됐는지 반환한다. */
  applyRemote: (record: SharedBlockRecord) => boolean;
  seedIfAbsent: (input: {
    id: string;
    workspaceId: string | null;
    kind: SharedBlockKind;
    data: SharedBlockData;
  }) => void;
};

export type SharedBlockStore = SharedBlockState & SharedBlockActions;

export function sharedBlockRecordKey(
  workspaceId: string | null,
  id: string,
): string {
  return JSON.stringify([workspaceId, id]);
}

export const useSharedBlockStore = create<SharedBlockStore>()(
  persist(
    (set, get) => ({
      records: {},

      applyRemote: (record) => {
        const key = sharedBlockRecordKey(record.workspaceId, record.id);
        const existing = get().records[key];
        // 같은 timestamp 충돌도 서버가 반환한 레코드를 권위 승자로 본다.
        if (existing && existing.updatedAt > record.updatedAt) return false;
        set((state) => ({
          records: { ...state.records, [key]: record },
        }));
        return true;
      },

      seedIfAbsent: ({ id, workspaceId, kind, data }) => {
        const key = sharedBlockRecordKey(workspaceId, id);
        if (get().records[key]) return;
        set((state) => ({
          records: {
            ...state.records,
            [key]: {
              id,
              workspaceId,
              kind,
              data,
              // 인라인 스냅샷은 fallback일 뿐 권위 데이터가 아니다.
              // 0으로 시드해 마운트 직후 서버 레코드가 항상 LWW 병합되게 한다.
              updatedAt: 0,
              deletedAt: null,
            },
          },
        }));
      },
    }),
    {
      name: "quicknote.shared-blocks.v2",
      storage: createJSONStorage(() => zustandStorage),
    },
  ),
);
