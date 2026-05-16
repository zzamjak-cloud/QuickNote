// LC 스케줄러 일정 데이터를 보관·동기화하는 Zustand 스토어.
// persist 미들웨어로 로컬 캐시를 유지하여 초기 로딩 시 빈 화면 방지.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { appsyncClient } from "../lib/sync/graphql/client";
import {
  LIST_SCHEDULES,
  CREATE_SCHEDULE,
  UPDATE_SCHEDULE,
  DELETE_SCHEDULE,
  type GqlSchedule,
} from "../lib/sync/graphql/operations";

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
  fetchSchedules: (workspaceId: string, from: string, to: string) => Promise<void>;
  createSchedule: (input: CreateScheduleInput) => Promise<Schedule>;
  updateSchedule: (input: UpdateScheduleInput) => Promise<Schedule>;
  deleteSchedule: (id: string, workspaceId: string) => Promise<void>;
  applyRemote: (s: Schedule) => void;
  removeLocal: (id: string) => void;
};

export const useSchedulerStore = create<SchedulerStore>()(
  persist(
    (set, get) => ({
      schedules: [],
      loading: false,
      cachedWorkspaceId: null,

      fetchSchedules: async (workspaceId, from, to) => {
        // 워크스페이스가 다르면 캐시를 비우고 시작 (다른 워크스페이스 데이터 노출 방지)
        if (get().cachedWorkspaceId !== workspaceId) {
          set({ schedules: [], cachedWorkspaceId: workspaceId });
        }
        // loading을 true로 올리지 않음 — 기존 캐시로 화면이 이미 그려진 상태 유지
        try {
          const r = await (appsyncClient().graphql({
            query: LIST_SCHEDULES,
            variables: { workspaceId, from, to },
          }) as Promise<{ data: { listSchedules: GqlSchedule[] } }>);
          set({ schedules: r.data.listSchedules as Schedule[], cachedWorkspaceId: workspaceId });
        } finally {
          set({ loading: false });
        }
      },

      createSchedule: async (input) => {
        const r = await (appsyncClient().graphql({
          query: CREATE_SCHEDULE,
          variables: { input },
        }) as Promise<{ data: { createSchedule: GqlSchedule } }>);
        const s = r.data.createSchedule as Schedule;
        set((st) => ({ schedules: [...st.schedules, s] }));
        return s;
      },

      updateSchedule: async (input) => {
        const r = await (appsyncClient().graphql({
          query: UPDATE_SCHEDULE,
          variables: { input },
        }) as Promise<{ data: { updateSchedule: GqlSchedule } }>);
        const s = r.data.updateSchedule as Schedule;
        set((st) => ({
          schedules: st.schedules.map((x) => (x.id === s.id ? s : x)),
        }));
        return s;
      },

      deleteSchedule: async (id, workspaceId) => {
        const prevSchedules = get().schedules;
        set((st) => ({ schedules: st.schedules.filter((x) => x.id !== id) }));
        try {
          await appsyncClient().graphql({
            query: DELETE_SCHEDULE,
            variables: { id, workspaceId },
          });
        } catch (error) {
          set({ schedules: prevSchedules });
          throw error;
        }
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
      }),
    },
  ),
);
