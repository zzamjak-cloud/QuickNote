import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { getDefaultMmWeek } from "../lib/scheduler/mm/weekUtils";
import { zustandStorage } from "../lib/storage/index";

export type MmDashboardRangeKind = "week" | "month" | "year";
export type MmDashboardInnerTab = "member" | "leader";
export type MmDashboardScopeFilter =
  | "all"
  | `organization:${string}`
  | `team:${string}`
  | `project:${string}`;

type MmDashboardViewState = {
  innerTab: MmDashboardInnerTab;
  rangeKind: MmDashboardRangeKind;
  weekStart: string;
  year: number;
  monthIndex: number;
  scope: MmDashboardScopeFilter;
  didApplyDefaultScope: boolean;
};

type MmDashboardViewActions = {
  setInnerTab: (tab: MmDashboardInnerTab) => void;
  setRangeKind: (kind: MmDashboardRangeKind) => void;
  setWeekStart: (weekStart: string) => void;
  setYear: (year: number) => void;
  setMonthIndex: (monthIndex: number) => void;
  setScope: (scope: MmDashboardScopeFilter) => void;
  setDidApplyDefaultScope: (value: boolean) => void;
};

export type MmDashboardViewStore = MmDashboardViewState & MmDashboardViewActions;

const now = new Date();
const initialState: MmDashboardViewState = {
  innerTab: "member",
  rangeKind: "week",
  weekStart: getDefaultMmWeek(),
  year: now.getFullYear(),
  monthIndex: now.getMonth(),
  scope: "all",
  didApplyDefaultScope: false,
};

function clampMonthIndex(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const month = Math.trunc(value);
  if (month < 0) return 0;
  if (month > 11) return 11;
  return month;
}

export const useSchedulerMmDashboardViewStore = create<MmDashboardViewStore>()(
  persist(
    (set, get) => ({
      ...initialState,
      setInnerTab: (innerTab) => set({ innerTab }),
      setRangeKind: (rangeKind) => set({ rangeKind }),
      setWeekStart: (weekStart) => set({ weekStart }),
      setYear: (year) =>
        set({
          year: Number.isFinite(year) ? Math.trunc(year) : get().year,
        }),
      setMonthIndex: (monthIndex) =>
        set({
          monthIndex: clampMonthIndex(monthIndex, get().monthIndex),
        }),
      setScope: (scope) => set({ scope }),
      setDidApplyDefaultScope: (didApplyDefaultScope) => set({ didApplyDefaultScope }),
    }),
    {
      name: "quicknote.scheduler.mmDashboard.view.v1",
      storage: createJSONStorage(() => zustandStorage),
      partialize: (state) => ({
        innerTab: state.innerTab,
        rangeKind: state.rangeKind,
        weekStart: state.weekStart,
        year: state.year,
        monthIndex: state.monthIndex,
        scope: state.scope,
        didApplyDefaultScope: state.didApplyDefaultScope,
      }),
    },
  ),
);
