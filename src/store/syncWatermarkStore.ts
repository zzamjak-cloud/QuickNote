// 워크스페이스별 증분 동기화 워터마크.
// 마지막으로 로컬에 성공 적용한 원격 항목의 최대 updatedAt(ISO)을 보관한다.
// 온라인 복귀·워크스페이스 전환 재페치 경로에서 이 값을 updatedAfter 로 넘겨 변경분만 받는다.
// 전체 페치는 캐시가 없거나 워터마크가 없는 첫 기준선 생성/복구 경로로 제한한다.

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { zustandStorage } from "../lib/storage/index";

type State = {
  /** workspaceId → 마지막 적용 항목의 최대 updatedAt(ISO 8601) */
  byWorkspace: Record<string, string>;
};

type Actions = {
  /** 워크스페이스의 현재 워터마크. 없으면 undefined(=전체 페치 필요). */
  getWatermark: (workspaceId: string) => string | undefined;
  /** 워터마크를 전진시킨다. 과거 값으로는 되돌리지 않는다(ISO 문자열 사전식 = 시간순). */
  advance: (workspaceId: string, isoUpdatedAt: string) => void;
  /** 워크스페이스 하나 또는 전체를 초기화한다. */
  reset: (workspaceId?: string) => void;
};

export const useSyncWatermarkStore = create<State & Actions>()(
  persist(
    (set, get) => ({
      byWorkspace: {},

      getWatermark: (workspaceId) => get().byWorkspace[workspaceId],

      advance: (workspaceId, isoUpdatedAt) =>
        set((s) => {
          if (!workspaceId || !isoUpdatedAt) return s;
          const current = s.byWorkspace[workspaceId];
          // 뒤로 가지 않음 — 더 큰(최신) 값일 때만 갱신.
          if (current && current >= isoUpdatedAt) return s;
          return { byWorkspace: { ...s.byWorkspace, [workspaceId]: isoUpdatedAt } };
        }),

      reset: (workspaceId) =>
        set((s) => {
          if (!workspaceId) return { byWorkspace: {} };
          if (!(workspaceId in s.byWorkspace)) return s;
          const next = { ...s.byWorkspace };
          delete next[workspaceId];
          return { byWorkspace: next };
        }),
    }),
    {
      name: "quicknote.sync.watermark.v1",
      storage: createJSONStorage(() => zustandStorage),
      partialize: (s) => ({ byWorkspace: s.byWorkspace }),
    },
  ),
);
