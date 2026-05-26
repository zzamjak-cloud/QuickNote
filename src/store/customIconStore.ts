// 워크스페이스 공유 커스텀 아이콘 캐시. 메모리 전용 — persist 미사용.
// 이유: persist 하이드레이션이 비동기라 fresh fetch 결과를 덮어쓰는 race 가능성.
// 데이터가 작고 (보통 수십 개), 부트스트랩 시점에 fetch + AppSync 구독으로 갱신되므로 캐시 불필요.

import { create } from "zustand";
import type { GqlCustomIcon } from "../lib/sync/graphql/operations";
import {
  listCustomIconsApi,
  createCustomIconApi,
  deleteCustomIconApi,
} from "../lib/sync/customIconApi";

type State = {
  /** workspaceId → 아이콘 목록 (최신순). */
  byWorkspace: Record<string, GqlCustomIcon[]>;
  /** workspaceId → 마지막 fetch 시각 (ms). */
  lastFetchedAt: Record<string, number>;
  loading: Record<string, boolean>;
};

type Actions = {
  fetch: (workspaceId: string) => Promise<void>;
  add: (input: { workspaceId: string; src: string; label: string }) => Promise<GqlCustomIcon>;
  remove: (id: string, workspaceId: string) => Promise<void>;
  /** 구독에서 도착한 새/삭제 아이콘 반영. deleted flag 는 호출자가 판단. */
  applyServerEvent: (icon: GqlCustomIcon, deleted: boolean) => void;
  clear: () => void;
};

export const useCustomIconStore = create<State & Actions>()((set, get) => ({
  byWorkspace: {},
  lastFetchedAt: {},
  loading: {},

      fetch: async (workspaceId) => {
        if (!workspaceId) return;
        if (get().loading[workspaceId]) return;
        set((s) => ({ loading: { ...s.loading, [workspaceId]: true } }));
        try {
          const icons = await listCustomIconsApi(workspaceId);
          set((s) => ({
            byWorkspace: { ...s.byWorkspace, [workspaceId]: icons },
            lastFetchedAt: { ...s.lastFetchedAt, [workspaceId]: Date.now() },
            loading: { ...s.loading, [workspaceId]: false },
          }));
        } catch (err) {
          set((s) => ({ loading: { ...s.loading, [workspaceId]: false } }));
          console.error("[customIconStore] fetch 실패", err);
        }
      },

      add: async (input) => {
        const created = await createCustomIconApi(input);
        set((s) => {
          const cur = s.byWorkspace[input.workspaceId] ?? [];
          return {
            byWorkspace: {
              ...s.byWorkspace,
              [input.workspaceId]: [created, ...cur.filter((i) => i.id !== created.id)],
            },
          };
        });
        return created;
      },

      remove: async (id, workspaceId) => {
        await deleteCustomIconApi(id, workspaceId);
        set((s) => {
          const cur = s.byWorkspace[workspaceId] ?? [];
          return {
            byWorkspace: { ...s.byWorkspace, [workspaceId]: cur.filter((i) => i.id !== id) },
          };
        });
      },

      applyServerEvent: (icon, deleted) => {
        set((s) => {
          const cur = s.byWorkspace[icon.workspaceId] ?? [];
          if (deleted) {
            return {
              byWorkspace: {
                ...s.byWorkspace,
                [icon.workspaceId]: cur.filter((i) => i.id !== icon.id),
              },
            };
          }
          // upsert by id (최신을 앞으로)
          const filtered = cur.filter((i) => i.id !== icon.id);
          return {
            byWorkspace: { ...s.byWorkspace, [icon.workspaceId]: [icon, ...filtered] },
          };
        });
      },

  clear: () => set({ byWorkspace: {}, lastFetchedAt: {}, loading: {} }),
}));
