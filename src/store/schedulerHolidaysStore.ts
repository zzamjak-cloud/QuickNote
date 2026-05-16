// LC 스케줄러 공휴일 스토어 — persist 미들웨어로 로컬 캐시 유지.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { appsyncClient } from "../lib/sync/graphql/client";
import {
  LIST_HOLIDAYS,
  CREATE_HOLIDAY,
  UPDATE_HOLIDAY,
  DELETE_HOLIDAY,
  type GqlHoliday,
} from "../lib/sync/graphql/operations";

export type HolidayType = "holiday" | "evaluation" | "release" | "meeting" | "custom";

export type SchedulerHoliday = {
  id: string;
  workspaceId: string;
  title: string;
  date: string;
  type: HolidayType;
  color: string;
  createdByMemberId: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateHolidayInput = {
  workspaceId: string;
  title: string;
  date: string;
  type: HolidayType;
  color: string;
};

export type UpdateHolidayInput = {
  id: string;
  workspaceId: string;
  title?: string | null;
  date?: string | null;
  type?: HolidayType | null;
  color?: string | null;
};

type SchedulerHolidaysStore = {
  holidays: SchedulerHoliday[];
  loading: boolean;
  /** 마지막으로 fetch한 workspaceId — 워크스페이스 전환 시 캐시 무효화에 사용 */
  workspaceId: string | null;
  fetchHolidays: (workspaceId: string) => Promise<void>;
  createHoliday: (input: CreateHolidayInput) => Promise<SchedulerHoliday>;
  updateHoliday: (input: UpdateHolidayInput) => Promise<SchedulerHoliday>;
  deleteHoliday: (id: string, workspaceId: string) => Promise<void>;
  applyRemote: (holiday: SchedulerHoliday) => void;
  removeLocal: (id: string) => void;
};

export const useSchedulerHolidaysStore = create<SchedulerHolidaysStore>()(
  persist(
    (set, get) => ({
      holidays: [],
      loading: false,
      workspaceId: null,

      fetchHolidays: async (workspaceId) => {
        // 워크스페이스가 다르면 캐시를 비우고 시작 (다른 워크스페이스 데이터 노출 방지)
        if (get().workspaceId !== workspaceId) {
          set({ holidays: [], workspaceId });
        }
        // loading을 true로 올리지 않음 — 기존 캐시로 화면이 이미 그려진 상태 유지
        try {
          const r = await (appsyncClient().graphql({
            query: LIST_HOLIDAYS,
            variables: { workspaceId },
          }) as Promise<{ data: { listHolidays: GqlHoliday[] } }>);
          set({ holidays: r.data.listHolidays as SchedulerHoliday[], workspaceId });
        } finally {
          set({ loading: false });
        }
      },

      createHoliday: async (input) => {
        const r = await (appsyncClient().graphql({
          query: CREATE_HOLIDAY,
          variables: { input },
        }) as Promise<{ data: { createHoliday: GqlHoliday } }>);
        const h = r.data.createHoliday as SchedulerHoliday;
        set((st) => ({ holidays: [...st.holidays, h] }));
        return h;
      },

      updateHoliday: async (input) => {
        const r = await (appsyncClient().graphql({
          query: UPDATE_HOLIDAY,
          variables: { input },
        }) as Promise<{ data: { updateHoliday: GqlHoliday } }>);
        const h = r.data.updateHoliday as SchedulerHoliday;
        set((st) => ({
          holidays: st.holidays.map((x) => (x.id === h.id ? h : x)),
        }));
        return h;
      },

      deleteHoliday: async (id, workspaceId) => {
        await appsyncClient().graphql({
          query: DELETE_HOLIDAY,
          variables: { id, workspaceId },
        });
        set((st) => ({ holidays: st.holidays.filter((x) => x.id !== id) }));
      },

      applyRemote: (holiday) => {
        set((st) => {
          const exists = st.holidays.find((x) => x.id === holiday.id);
          if (exists) {
            return { holidays: st.holidays.map((x) => (x.id === holiday.id ? holiday : x)) };
          }
          return { holidays: [...st.holidays, holiday] };
        });
      },

      removeLocal: (id) => {
        set((st) => ({ holidays: st.holidays.filter((x) => x.id !== id) }));
      },
    }),
    {
      name: "quicknote.scheduler.cache.holidays.v1",
      // 휘발성 상태(loading)는 제외하고 데이터 배열과 workspaceId만 저장
      partialize: (st) => ({
        holidays: st.holidays,
        workspaceId: st.workspaceId,
      }),
    },
  ),
);
