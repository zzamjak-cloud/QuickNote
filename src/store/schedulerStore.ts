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
import {
  DEFAULT_SCHEDULE_COLOR,
  GLOBAL_EVENT_COLOR,
  pickTextColor,
} from "../lib/scheduler/colors";
import { useMemberStore } from "./memberStore";
import { useSchedulerViewStore } from "./schedulerViewStore";
import { filterSchedulesByRange, scheduleOverlapsRange } from "../lib/scheduler/selectors/scheduleSelectors";
import { logSchedulerPerf, nowSchedulerPerf } from "../lib/scheduler/performance";

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

function projectSchedulesForStore(workspaceId: string, from?: string, to?: string): Schedule[] {
  const projected = projectLCSchedulerSchedules(workspaceId, useMemberStore.getState().members);
  return filterSchedulesByRange(projected, from, to);
}

function makeOptimisticSchedule(input: CreateScheduleInput): Schedule {
  const now = new Date().toISOString();
  const color = input.color ?? ((input.assigneeId ?? null) === null ? GLOBAL_EVENT_COLOR : DEFAULT_SCHEDULE_COLOR);
  const idSeed = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id: `optimistic:${idSeed}`,
    workspaceId: input.workspaceId,
    title: input.title,
    comment: input.comment ?? null,
    link: input.link ?? null,
    projectId: input.projectId ?? null,
    startAt: input.startAt,
    endAt: input.endAt,
    assigneeId: input.assigneeId ?? null,
    color,
    textColor: input.textColor ?? pickTextColor(color),
    rowIndex: input.rowIndex ?? 0,
    createdByMemberId: "",
    createdAt: now,
    updatedAt: now,
  };
}

function applyOptimisticScheduleUpdate(schedule: Schedule, input: UpdateScheduleInput): Schedule {
  return {
    ...schedule,
    title: input.title !== undefined && input.title !== null ? input.title : schedule.title,
    comment: input.comment !== undefined ? input.comment : schedule.comment,
    link: input.link !== undefined ? input.link : schedule.link,
    projectId: input.projectId !== undefined ? input.projectId : schedule.projectId,
    startAt: input.startAt ?? schedule.startAt,
    endAt: input.endAt ?? schedule.endAt,
    assigneeId: input.assigneeId !== undefined ? input.assigneeId : schedule.assigneeId,
    color: input.color !== undefined ? input.color : schedule.color,
    textColor: input.textColor !== undefined ? input.textColor : schedule.textColor,
    rowIndex: input.rowIndex !== undefined ? input.rowIndex : schedule.rowIndex,
    updatedAt: new Date().toISOString(),
  };
}

function isOptimisticScheduleId(id: string): boolean {
  return id.startsWith("optimistic:");
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
        const startedAt = nowSchedulerPerf();
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
        logSchedulerPerf("fetchSchedules:project-visible-range", startedAt, {
          workspaceId,
          from,
          to,
          count: get().schedules.length,
        });
      },

      createSchedule: async (input) => {
        const rangeFrom = get().visibleRangeFrom ?? undefined;
        const rangeTo = get().visibleRangeTo ?? undefined;
        const optimistic = makeOptimisticSchedule(input);
        const shouldShowOptimistic = !rangeFrom || !rangeTo || scheduleOverlapsRange(optimistic, rangeFrom, rangeTo);
        if (shouldShowOptimistic) {
          set((st) => ({
            schedules: [
              ...st.schedules.filter((schedule) => schedule.id !== optimistic.id),
              optimistic,
            ],
            cachedWorkspaceId: input.workspaceId,
          }));
        }
        try {
          const s = await createLCSchedulerSchedule({
            ...input,
            selectedScopeKey: input.selectedScopeKey ?? useSchedulerViewStore.getState().selectedProjectId,
          });
          set({
            schedules: projectSchedulesForStore(input.workspaceId, rangeFrom, rangeTo),
            cachedWorkspaceId: input.workspaceId,
          });
          return s;
        } catch (error) {
          set((st) => ({
            schedules: st.schedules.filter((schedule) => schedule.id !== optimistic.id),
          }));
          throw error;
        }
      },

      updateSchedule: async (input) => {
        const rangeFrom = get().visibleRangeFrom ?? undefined;
        const rangeTo = get().visibleRangeTo ?? undefined;
        const previousSchedules = get().schedules;
        if (previousSchedules.some((schedule) => schedule.id === input.id)) {
          set((state) => ({
            schedules: state.schedules.map((schedule) => (
              schedule.id === input.id ? applyOptimisticScheduleUpdate(schedule, input) : schedule
            )),
            cachedWorkspaceId: input.workspaceId,
          }));
        }
        try {
          const s = await updateLCSchedulerSchedule(input);
          set({
            schedules: projectSchedulesForStore(input.workspaceId, rangeFrom, rangeTo),
            cachedWorkspaceId: input.workspaceId,
          });
          return s;
        } catch (error) {
          set({ schedules: previousSchedules, cachedWorkspaceId: input.workspaceId });
          throw error;
        }
      },

      deleteSchedule: async (id, workspaceId) => {
        const previousSchedules = get().schedules;
        set((st) => ({ schedules: st.schedules.filter((x) => x.id !== id) }));
        const rangeFrom = get().visibleRangeFrom ?? undefined;
        const rangeTo = get().visibleRangeTo ?? undefined;
        try {
          await deleteLCSchedulerSchedule(id, workspaceId);
          set({
            schedules: projectSchedulesForStore(workspaceId, rangeFrom, rangeTo),
            cachedWorkspaceId: workspaceId,
          });
        } catch (error) {
          set({ schedules: previousSchedules, cachedWorkspaceId: workspaceId });
          throw error;
        }
      },

      refreshVisibleRangeFromLocal: (workspaceId) => {
        const startedAt = nowSchedulerPerf();
        const targetWorkspaceId = workspaceId ?? get().cachedWorkspaceId;
        if (!targetWorkspaceId) return;
        const rangeFrom = get().visibleRangeFrom ?? undefined;
        const rangeTo = get().visibleRangeTo ?? undefined;
        set({
          schedules: projectSchedulesForStore(targetWorkspaceId, rangeFrom, rangeTo),
          cachedWorkspaceId: targetWorkspaceId,
        });
        logSchedulerPerf("refreshVisibleRangeFromLocal", startedAt, {
          workspaceId: targetWorkspaceId,
          from: rangeFrom,
          to: rangeTo,
          count: get().schedules.length,
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
        schedules: st.schedules.filter((schedule) => !isOptimisticScheduleId(schedule.id)),
        cachedWorkspaceId: st.cachedWorkspaceId,
        visibleRangeFrom: st.visibleRangeFrom,
        visibleRangeTo: st.visibleRangeTo,
      }),
    },
  ),
);
