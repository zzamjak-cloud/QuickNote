// 스케줄러 조직·팀 활성/비활성 필터 스토어.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

type FiltersState = {
  // 비활성 조직 ID 목록
  disabledOrgIds: string[];
  // 비활성 팀 ID 목록
  disabledTeamIds: string[];
};

type FiltersActions = {
  toggleOrg: (id: string) => void;
  toggleTeam: (id: string) => void;
};

export type SchedulerFiltersStore = FiltersState & FiltersActions;

export const useSchedulerFiltersStore = create<SchedulerFiltersStore>()(
  persist(
    (set) => ({
      disabledOrgIds: [],
      disabledTeamIds: [],

      // 조직 활성/비활성 토글
      toggleOrg: (id) =>
        set((s) => ({
          disabledOrgIds: s.disabledOrgIds.includes(id)
            ? s.disabledOrgIds.filter((x) => x !== id)
            : [...s.disabledOrgIds, id],
        })),

      // 팀 활성/비활성 토글
      toggleTeam: (id) =>
        set((s) => ({
          disabledTeamIds: s.disabledTeamIds.includes(id)
            ? s.disabledTeamIds.filter((x) => x !== id)
            : [...s.disabledTeamIds, id],
        })),
    }),
    {
      name: "quicknote.scheduler.filters.v1",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
