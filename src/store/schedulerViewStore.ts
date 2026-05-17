// LC 스케줄러 뷰 상태(줌·필터·뷰 모드 등) 로컬 스토어.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { DEFAULT_SCHEDULE_COLOR, DEFAULT_WEEKEND_COLOR } from "../lib/scheduler/colors";

export type SchedulerViewMode = "year" | "week";

export type MonthVisibility = Record<number, boolean>;

const allMonthsVisible: MonthVisibility = (() => {
  const m: MonthVisibility = {};
  for (let i = 1; i <= 12; i++) m[i] = true;
  return m;
})();

type ViewState = {
  // 뷰 모드
  viewMode: SchedulerViewMode;

  // 줌
  zoomLevel: number;
  columnWidthScale: number;

  // 현재 표시
  currentYear: number;

  // 선택 / 필터
  selectedMemberId: string | null;
  selectedProjectId: string | null;
  selectedJobTitle: string | null;
  monthVisibility: MonthVisibility;
  jobTitleFilter: string[] | null;

  // 색상 기본값
  defaultScheduleColor: string;
  weekendColor: string;

  // 주간 뷰 필터
  weekViewMemberIds: string[] | null;
  weekViewProjectScope: "all" | "project";

  // 선택 상태(드래그·다중 선택)
  selectedScheduleId: string | null;
  multiSelectedIds: string[];
  mmWeekStart: string | null;
};

type ViewActions = {
  setViewMode: (m: SchedulerViewMode) => void;
  setZoomLevel: (z: number) => void;
  setColumnWidthScale: (s: number) => void;
  setCurrentYear: (y: number) => void;
  selectMember: (id: string | null) => void;
  setSelectedProjectId: (id: string | null) => void;
  setSelectedJobTitle: (s: string | null) => void;
  toggleMonthVisibility: (m: number) => void;
  setMonthVisibility: (mv: MonthVisibility) => void;
  setJobTitleFilter: (titles: string[] | null) => void;
  setDefaultScheduleColor: (hex: string) => void;
  setWeekendColor: (hex: string) => void;
  setWeekViewMemberIds: (ids: string[] | null) => void;
  setWeekViewProjectScope: (s: "all" | "project") => void;
  selectSchedule: (id: string | null) => void;
  setMultiSelected: (ids: string[]) => void;
  setMmWeekStart: (weekStart: string | null) => void;
  clear: () => void;
};

export type SchedulerViewStore = ViewState & ViewActions;

const initial: ViewState = {
  viewMode: "year",
  zoomLevel: 1,
  columnWidthScale: 1,
  currentYear: new Date().getFullYear(),
  selectedMemberId: null,
  selectedProjectId: null,
  selectedJobTitle: null,
  monthVisibility: allMonthsVisible,
  jobTitleFilter: null,
  defaultScheduleColor: DEFAULT_SCHEDULE_COLOR,
  weekendColor: DEFAULT_WEEKEND_COLOR,
  weekViewMemberIds: null,
  weekViewProjectScope: "all",
  selectedScheduleId: null,
  multiSelectedIds: [],
  mmWeekStart: null,
};

export const useSchedulerViewStore = create<SchedulerViewStore>()(
  persist(
    (set) => ({
      ...initial,
      setViewMode: (viewMode) => set({ viewMode }),
      setZoomLevel: (zoomLevel) => set({ zoomLevel }),
      setColumnWidthScale: (columnWidthScale) => set({ columnWidthScale }),
      setCurrentYear: (currentYear) => set({ currentYear }),
      selectMember: (selectedMemberId) => set({ selectedMemberId }),
      setSelectedProjectId: (selectedProjectId) => set({ selectedProjectId }),
      setSelectedJobTitle: (selectedJobTitle) => set({ selectedJobTitle }),
      toggleMonthVisibility: (m) =>
        set((s) => ({
          monthVisibility: { ...s.monthVisibility, [m]: !s.monthVisibility[m] },
        })),
      setMonthVisibility: (monthVisibility) => set({ monthVisibility }),
      setJobTitleFilter: (jobTitleFilter) => set({ jobTitleFilter }),
      setDefaultScheduleColor: (defaultScheduleColor) => set({ defaultScheduleColor }),
      setWeekendColor: (weekendColor) => set({ weekendColor }),
      setWeekViewMemberIds: (weekViewMemberIds) => set({ weekViewMemberIds }),
      setWeekViewProjectScope: (weekViewProjectScope) => set({ weekViewProjectScope }),
      selectSchedule: (selectedScheduleId) => set({ selectedScheduleId }),
      setMultiSelected: (multiSelectedIds) => set({ multiSelectedIds }),
      setMmWeekStart: (mmWeekStart) => set({ mmWeekStart }),
      clear: () => set(initial),
    }),
    {
      name: "quicknote.scheduler.view.v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        viewMode: s.viewMode,
        zoomLevel: s.zoomLevel,
        columnWidthScale: s.columnWidthScale,
        currentYear: s.currentYear,
        monthVisibility: s.monthVisibility,
        defaultScheduleColor: s.defaultScheduleColor,
        weekendColor: s.weekendColor,
        weekViewProjectScope: s.weekViewProjectScope,
        // 마지막 방문 선택 상태 — 창을 닫았다 다시 열어도 유지
        selectedProjectId: s.selectedProjectId,
        selectedMemberId: s.selectedMemberId,
        selectedJobTitle: s.selectedJobTitle,
        jobTitleFilter: s.jobTitleFilter,
        multiSelectedIds: s.multiSelectedIds,
        weekViewMemberIds: s.weekViewMemberIds,
      }),
    },
  ),
);
