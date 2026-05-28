// 페이지 검색 팝업의 단계별 필터를 사용자 단말에 영구 보관.
// 키 = `${databaseId}:${columnId}` — 컬럼마다 마지막 사용한 필터 체인이 유지된다.
// 다른 사용자/디바이스로 동기화되지 않는 로컬 prefs.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { SearchFilterRule } from "../types/database";
import { zustandStorage } from "../lib/storage/index";

type State = {
  /** `${databaseId}:${columnId}` → 사용자가 최종 적용한 필터 단계 */
  presetsByKey: Record<string, SearchFilterRule[]>;
};

type Actions = {
  /** 필터 단계 전체 교체 — 빈 배열이면 키 자체 삭제 */
  setPresets: (key: string, rules: SearchFilterRule[]) => void;
  /** 모든 prefs 삭제 (테스트·진단용) */
  clear: () => void;
};

export type SearchFilterPrefsStore = State & Actions;

export const useSearchFilterPrefsStore = create<SearchFilterPrefsStore>()(
  persist(
    (set) => ({
      presetsByKey: {},
      setPresets: (key, rules) =>
        set((state) => {
          const next = { ...state.presetsByKey };
          if (rules.length === 0) {
            delete next[key];
          } else {
            next[key] = rules;
          }
          return { presetsByKey: next };
        }),
      clear: () => set({ presetsByKey: {} }),
    }),
    {
      name: "quicknote.search-filter-prefs.v1",
      storage: createJSONStorage(() => zustandStorage),
    },
  ),
);

/** 컬럼 키 생성기 — store key 일관성을 위해 한곳에서 만든다. */
export function makeSearchFilterPrefKey(databaseId: string, columnId: string): string {
  return `${databaseId}:${columnId}`;
}
