// LC 스케줄러 일정 데이터를 보관·동기화하는 Zustand 스토어.
// persist 미들웨어로 로컬 캐시를 유지하여 초기 로딩 시 빈 화면 방지.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  createLCSchedulerSchedule,
  deleteLCSchedulerSchedule,
  projectLCSchedulerSchedules,
  updateLCSchedulerSchedule,
} from "../lib/scheduler/taskAdapter";
import { ensureLCSchedulerDatabase } from "../lib/scheduler/database";
import { useMemberStore } from "./memberStore";
import { useSchedulerViewStore } from "./schedulerViewStore";

export type Schedule = {
  id: string;
  workspaceId: string;
  title: string;
  comment?: string | null;
  link?: string | null;
  projectId?: string | null;
  startAt: string;
  endAt: string;
  assigneeId?: string | null;
  color?: string | null;
  textColor?: string | null;
  rowIndex?: number | null;
  createdByMemberId: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateScheduleInput = {
  workspaceId: string;
  title: string;
  comment?: string | null;
  link?: string | null;
  projectId?: string | null;
  startAt: string;
  endAt: string;
  assigneeId?: string | null;
  color?: string | null;
  textColor?: string | null;
  rowIndex?: number | null;
  /** 현재 헤더 선택 스코프("org:{id}" | "team:{id}" | "proj:{id}") */
  selectedScopeKey?: string | null;
};

export type UpdateScheduleInput = {
  id: string;
  workspaceId: string;
  title?: string | null;
  comment?: string | null;
  link?: string | null;
  projectId?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  assigneeId?: string | null;
  color?: string | null;
  textColor?: string | null;
  rowIndex?: number | null;
};

type SchedulerStore = {
  schedules: Schedule[];
  loading: boolean;
  /** 마지막으로 캐시된 workspaceId — 워크스페이스 전환 시 캐시 무효화에 사용 */
  cachedWorkspaceId: string | null;
  /** 마지막 렌더 범위(캐시 재투영 기준) */
  visibleRangeFrom: string | null;
  visibleRangeTo: string | null;
  fetchSchedules: (workspaceId: string, from: string, to: string) => Promise<void>;
  createSchedule: (input: CreateScheduleInput) => Promise<Schedule>;
  updateSchedule: (input: UpdateScheduleInput) => Promise<Schedule>;
  deleteSchedule: (id: string, workspaceId: string) => Promise<void>;
  refreshVisibleRangeFromLocal: (workspaceId?: string | null) => void;
  applyRemote: (s: Schedule) => void;
  removeLocal: (id: string) => void;
};

function scheduleOverlapsRange(schedule: Schedule, from: string, to: string): boolean {
  const start = Date.parse(schedule.startAt);
  const end = Date.parse(schedule.endAt);
  const rangeStart = Date.parse(from);
  const rangeEnd = Date.parse(to);
  if ([start, end, rangeStart, rangeEnd].some((value) => Number.isNaN(value))) return true;
  return start < rangeEnd && end > rangeStart;
}

function projectSchedulesForStore(workspaceId: string, from?: string, to?: string): Schedule[] {
  const projected = projectLCSchedulerSchedules(workspaceId, useMemberStore.getState().members);
  if (!from || !to) return projected;
  return projected.filter((schedule) => scheduleOverlapsRange(schedule, from, to));
}

export const useSchedulerStore = create<SchedulerStore>()(
  persist(
    (set, get) => ({
      schedules: [],
      loading: false,
      cachedWorkspaceId: null,
      visibleRangeFrom: null,
      visibleRangeTo: null,

      fetchSchedules: async (workspaceId, from, to) => {
        // 워크스페이스가 다르면 캐시를 비우고 시작 (다른 워크스페이스 데이터 노출 방지)
        if (get().cachedWorkspaceId !== workspaceId) {
          set({ schedules: [], cachedWorkspaceId: workspaceId });
        }
        // loading을 true로 올리지 않음 — 기존 캐시로 화면이 이미 그려진 상태 유지
        await ensureLCSchedulerDatabase(workspaceId);
        set({
          schedules: projectSchedulesForStore(workspaceId, from, to),
          cachedWorkspaceId: workspaceId,
          visibleRangeFrom: from,
          visibleRangeTo: to,
          loading: false,
        });
      },

      createSchedule: async (input) => {
        const s = await createLCSchedulerSchedule({
          ...input,
          selectedScopeKey: input.selectedScopeKey ?? useSchedulerViewStore.getState().selectedProjectId,
        });
        const rangeFrom = get().visibleRangeFrom ?? undefined;
        const rangeTo = get().visibleRangeTo ?? undefined;
        set({
          schedules: projectSchedulesForStore(input.workspaceId, rangeFrom, rangeTo),
          cachedWorkspaceId: input.workspaceId,
        });
        return s;
      },

      updateSchedule: async (input) => {
        const s = await updateLCSchedulerSchedule(input);
        const rangeFrom = get().visibleRangeFrom ?? undefined;
        const rangeTo = get().visibleRangeTo ?? undefined;
        set({
          schedules: projectSchedulesForStore(input.workspaceId, rangeFrom, rangeTo),
          cachedWorkspaceId: input.workspaceId,
        });
        return s;
      },

      deleteSchedule: async (id, workspaceId) => {
        const prevSchedules = get().schedules;
        set((st) => ({ schedules: st.schedules.filter((x) => x.id !== id) }));
        try {
          await deleteLCSchedulerSchedule(id, workspaceId);
          const rangeFrom = get().visibleRangeFrom ?? undefined;
          const rangeTo = get().visibleRangeTo ?? undefined;
          set({
            schedules: projectSchedulesForStore(workspaceId, rangeFrom, rangeTo),
            cachedWorkspaceId: workspaceId,
          });
        } catch (error) {
          set({ schedules: prevSchedules });
          throw error;
        }
      },

      refreshVisibleRangeFromLocal: (workspaceId) => {
        const targetWorkspaceId = workspaceId ?? get().cachedWorkspaceId;
        if (!targetWorkspaceId) return;
        const rangeFrom = get().visibleRangeFrom ?? undefined;
        const rangeTo = get().visibleRangeTo ?? undefined;
        set({
          schedules: projectSchedulesForStore(targetWorkspaceId, rangeFrom, rangeTo),
          cachedWorkspaceId: targetWorkspaceId,
        });
      },

      applyRemote: (s) => {
        set((st) => {
          const exists = st.schedules.find((x) => x.id === s.id);
          if (exists) {
            return { schedules: st.schedules.map((x) => (x.id === s.id ? s : x)) };
          }
          return { schedules: [...st.schedules, s] };
        });
      },

      removeLocal: (id) => {
        set((st) => ({ schedules: st.schedules.filter((x) => x.id !== id) }));
      },
    }),
    {
      name: "quicknote.scheduler.cache.schedules.v1",
      // 휘발성 상태(loading)는 제외하고 데이터 배열과 workspaceId만 저장
      partialize: (st) => ({
        schedules: st.schedules,
        cachedWorkspaceId: st.cachedWorkspaceId,
        visibleRangeFrom: st.visibleRangeFrom,
        visibleRangeTo: st.visibleRangeTo,
      }),
    },
  ),
);
