import { create } from "zustand";
import { listMyAssetsApi } from "../lib/sync/assetApi";
import type { GqlAsset } from "../lib/sync/graphql/operations";

// 자산 목록 세션 캐시 — 디스크에 persist 하지 않는 앱 세션 메모리 한정 캐시.
// 자산 탭은 매 진입마다 서버를 호출하지 않고 이 캐시를 재사용한다(A).
// 갱신은 사용자가 "새로고침" 버튼을 누를 때(refresh)만 일어난다.
// 목록은 listMyAssets(사용자 전역)이라 워크스페이스와 무관하게 단일 캐시를 쓴다.

// C — 한 번의 거대한 쿼리 대신 nextToken 으로 페이지를 나눠 받아 페이로드·Lambda 부담을 낮춘다.
const PAGE_LIMIT = 200;

function dedupeById(items: GqlAsset[]): GqlAsset[] {
  const seen = new Set<string>();
  const out: GqlAsset[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

type AssetCacheState = {
  items: GqlAsset[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
};

type AssetCacheActions = {
  /** 캐시가 없을 때만 1회 전체 로드. 이미 로드됐거나 진행 중이면 재요청하지 않는다. */
  ensureLoaded: () => Promise<void>;
  /** 새로고침 버튼 전용 — 캐시를 버리고 서버에서 강제 재로드. */
  refresh: () => Promise<void>;
  /** 삭제 결과를 캐시에 반영(서버 재요청 없이). */
  removeMany: (ids: string[]) => void;
  /** 이름 변경 등 단일 자산 패치를 캐시에 반영. */
  patchOne: (id: string, patch: Partial<GqlAsset>) => void;
};

export type AssetCacheStore = AssetCacheState & AssetCacheActions;

// 동시 호출(StrictMode 이중 마운트 등) 시 중복 로드를 막는 인플라이트 공유 프라미스.
let inflight: Promise<void> | null = null;

export const useAssetCacheStore = create<AssetCacheStore>((set, get) => {
  const loadAll = async (): Promise<void> => {
    set({ loading: true, error: null });
    try {
      const acc: GqlAsset[] = [];
      let token: string | null = null;
      do {
        const res = await listMyAssetsApi({
          limit: PAGE_LIMIT,
          ...(token ? { nextToken: token } : {}),
        });
        acc.push(...res.items);
        token = res.nextToken;
        // 받은 만큼 점진적으로 표시(첫 페이지부터 즉시 노출).
        set({ items: dedupeById(acc) });
      } while (token);
      set({ loaded: true, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  };

  return {
    items: [],
    loaded: false,
    loading: false,
    error: null,
    ensureLoaded: async () => {
      if (get().loaded) return;
      if (inflight) {
        await inflight;
        return;
      }
      inflight = loadAll().finally(() => {
        inflight = null;
      });
      await inflight;
    },
    refresh: async () => {
      if (inflight) await inflight;
      set({ loaded: false });
      inflight = loadAll().finally(() => {
        inflight = null;
      });
      await inflight;
    },
    removeMany: (ids) => {
      const del = new Set(ids);
      set((s) => ({ items: s.items.filter((a) => !del.has(a.id)) }));
    },
    patchOne: (id, patch) => {
      set((s) => ({
        items: s.items.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      }));
    },
  };
});
