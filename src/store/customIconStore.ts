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
  /** 여러 워크스페이스 아이콘을 병렬 적재. 개별 실패는 fetch 내부에서 무시된다. */
  fetchAll: (workspaceIds: string[]) => Promise<void>;
  add: (input: { workspaceId: string; src: string; label: string }) => Promise<GqlCustomIcon>;
  remove: (id: string, workspaceId: string) => Promise<void>;
  /** 구독에서 도착한 새/삭제 아이콘 반영. deleted flag 는 호출자가 판단. */
  applyServerEvent: (icon: GqlCustomIcon, deleted: boolean) => void;
  /** 모든 워크스페이스 아이콘을 합쳐 deletedAt 없는 것만, src 중복 제거(최신 우선), createdAt 내림차순으로 반환. */
  getAllIcons: () => GqlCustomIcon[];
  clear: () => void;
};

// byWorkspace 전체를 전역 집계 목록으로 변환. 컴포넌트 useMemo 와 store getAllIcons 가 공유.
export function aggregateCustomIcons(
  byWorkspace: Record<string, GqlCustomIcon[]>,
): GqlCustomIcon[] {
  const all = Object.values(byWorkspace)
    .flat()
    .filter((icon) => !icon.deletedAt);
  // src 기준 중복 제거 — 같은 이미지는 createdAt 최신 1개만 유지.
  const bySrc = new Map<string, GqlCustomIcon>();
  for (const icon of all) {
    const prev = bySrc.get(icon.src);
    if (!prev || (icon.createdAt ?? "") > (prev.createdAt ?? "")) {
      bySrc.set(icon.src, icon);
    }
  }
  return Array.from(bySrc.values()).sort((a, b) =>
    (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
  );
}

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

      fetchAll: async (workspaceIds) => {
        await Promise.all(
          workspaceIds
            .filter(Boolean)
            .map((id) => get().fetch(id).catch(() => undefined)),
        );
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

  getAllIcons: () => aggregateCustomIcons(get().byWorkspace),

  clear: () => set({ byWorkspace: {}, lastFetchedAt: {}, loading: {} }),
}));
