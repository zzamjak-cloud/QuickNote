// LC 스케줄러 일정 데이터를 보관·동기화하는 Zustand 스토어.
// persist 미들웨어로 로컬 캐시를 유지하여 초기 로딩 시 빈 화면 방지.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  createLCSchedulerSchedule,
  deleteLCSchedulerSchedule,
  parseScheduleInstanceId,
  projectLCSchedulerPageSchedules,
  projectLCSchedulerSchedules,
  updateLCSchedulerSchedule,
} from "../lib/scheduler/taskAdapter";
import { LC_SCHEDULER_ATTENDANCE_TITLE, ensureLCSchedulerDatabase } from "../lib/scheduler/database";
import { ensureLCMilestoneDatabase } from "../lib/scheduler/milestoneDatabase";
import { ensureLCFeatureDatabase } from "../lib/scheduler/featureDatabase";
import { LC_SCHEDULER_WORKSPACE_ID } from "../lib/scheduler/scope";
import {
  DEFAULT_SCHEDULE_COLOR,
  GLOBAL_EVENT_COLOR,
  pickTextColor,
} from "../lib/scheduler/colors";
import { useMemberStore } from "./memberStore";
import { useSchedulerViewStore } from "./schedulerViewStore";
import { filterSchedulesByRange, scheduleOverlapsRange } from "../lib/scheduler/selectors/scheduleSelectors";
import { logSchedulerPerf, nowSchedulerPerf } from "../lib/scheduler/performance";
import { makeDeferredStorage } from "../lib/storage/index";

const deferredSchedulerStorage = makeDeferredStorage();
import { fetchDatabasesByWorkspace, fetchPagesByWorkspace } from "../lib/sync/bootstrap";
import { getSyncEngine } from "../lib/sync/runtime";
import { reconcileLCSchedulerRemoteSnapshot } from "../lib/sync/storeApply";

export type Schedule = {
  id: string;
  workspaceId: string;
  title: string;
  comment?: string | null;
  link?: string | null;
  kind?: "schedule" | "leave";
  projectId?: string | null;
  teamId?: string | null;
  organizationId?: string | null;
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
  refreshSchedulePageFromLocal: (pageId: string, workspaceId?: string | null) => void;
  refreshSchedulePagesFromLocal: (pageIds: Iterable<string>, workspaceId?: string | null) => void;
  applyRemote: (s: Schedule) => void;
  removeLocal: (id: string) => void;
};

function projectSchedulesForStore(workspaceId: string, from?: string, to?: string): Schedule[] {
  const projected = projectLCSchedulerSchedules(workspaceId, useMemberStore.getState().members);
  return filterSchedulesByRange(projected, from, to);
}

function projectSchedulesForPage(workspaceId: string, pageId: string, from?: string, to?: string): Schedule[] {
  const projected = projectLCSchedulerPageSchedules(workspaceId, pageId, useMemberStore.getState().members);
  return filterSchedulesByRange(projected, from, to);
}

function sameSchedule(a: Schedule, b: Schedule): boolean {
  return (
    a.id === b.id &&
    a.workspaceId === b.workspaceId &&
    a.title === b.title &&
    a.comment === b.comment &&
    a.link === b.link &&
    a.kind === b.kind &&
    a.projectId === b.projectId &&
    a.teamId === b.teamId &&
    a.organizationId === b.organizationId &&
    a.startAt === b.startAt &&
    a.endAt === b.endAt &&
    a.assigneeId === b.assigneeId &&
    a.color === b.color &&
    a.textColor === b.textColor &&
    a.rowIndex === b.rowIndex &&
    a.createdByMemberId === b.createdByMemberId &&
    a.createdAt === b.createdAt &&
    a.updatedAt === b.updatedAt
  );
}

function sameScheduleArray(a: Schedule[], b: Schedule[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    return other !== undefined && sameSchedule(item, other);
  });
}

function replaceSchedulesForPages(
  current: Schedule[],
  pageIds: Set<string>,
  incoming: Schedule[],
): Schedule[] {
  if (pageIds.size === 0) return current;
  const kept: Schedule[] = [];
  let insertAt = -1;
  let removed = false;
  current.forEach((schedule) => {
    const pageId = parseScheduleInstanceId(schedule.id)?.pageId;
    if (pageId && pageIds.has(pageId)) {
      if (insertAt < 0) insertAt = kept.length;
      removed = true;
      return;
    }
    kept.push(schedule);
  });
  if (!removed && incoming.length === 0) return current;
  const normalizedInsertAt = insertAt < 0 ? kept.length : insertAt;
  const next = [
    ...kept.slice(0, normalizedInsertAt),
    ...incoming,
    ...kept.slice(normalizedInsertAt),
  ];
  return sameScheduleArray(current, next) ? current : next;
}

function makeOptimisticSchedule(input: CreateScheduleInput): Schedule {
  const now = new Date().toISOString();
  const color = input.color ?? ((input.assigneeId ?? null) === null ? GLOBAL_EVENT_COLOR : DEFAULT_SCHEDULE_COLOR);
  const selectedScopeKey = input.selectedScopeKey ?? useSchedulerViewStore.getState().selectedProjectId;
  const isAttendanceCreate = input.title === LC_SCHEDULER_ATTENDANCE_TITLE || input.title === "연차";
  const idSeed = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id: `optimistic:${idSeed}`,
    workspaceId: input.workspaceId,
    title: isAttendanceCreate ? "연차" : input.title,
    comment: input.comment ?? null,
    link: input.link ?? null,
    kind: isAttendanceCreate ? "leave" : "schedule",
    projectId: input.projectId ?? null,
    teamId: selectedScopeKey?.startsWith("team:") ? selectedScopeKey.slice(5) : null,
    organizationId: selectedScopeKey?.startsWith("org:") ? selectedScopeKey.slice(4) : null,
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

let schedulerRemoteReconcileInFlight: Promise<void> | null = null;

async function getPendingLCSchedulerPageIds(): Promise<Set<string>> {
  const engine = await getSyncEngine();
  const snapshot = (await engine.debugSnapshot()) as Array<{
    workspaceId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
  }>;
  return new Set(
    snapshot
      .filter(
        (entry) =>
          entry.workspaceId === LC_SCHEDULER_WORKSPACE_ID &&
          entry.entityType === "page" &&
          typeof entry.entityId === "string" &&
          entry.entityId.length > 0,
      )
      .map((entry) => entry.entityId as string),
  );
}

async function reconcileSchedulerWorkspaceFromServer(workspaceId: string): Promise<void> {
  if (workspaceId !== LC_SCHEDULER_WORKSPACE_ID) return;
  if (!schedulerRemoteReconcileInFlight) {
    schedulerRemoteReconcileInFlight = (async () => {
      const engine = await getSyncEngine();
      await engine.flush();
      const protectedPageIds = await getPendingLCSchedulerPageIds();
      const [pages, databases] = await Promise.all([
        fetchPagesByWorkspace(LC_SCHEDULER_WORKSPACE_ID),
        fetchDatabasesByWorkspace(LC_SCHEDULER_WORKSPACE_ID),
      ]);
      const { prunedPageIds } = reconcileLCSchedulerRemoteSnapshot({
        pages,
        databases,
        protectedPageIds,
      });
      if (prunedPageIds.length > 0) {
        console.warn("[scheduler] stale local cards pruned from server snapshot", {
          count: prunedPageIds.length,
        });
      }
    })().finally(() => {
      schedulerRemoteReconcileInFlight = null;
    });
  }
  await schedulerRemoteReconcileInFlight;
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
        const current = get();
        const hasSameVisibleCache =
          current.cachedWorkspaceId === workspaceId &&
          current.visibleRangeFrom === from &&
          current.visibleRangeTo === to;
        if (hasSameVisibleCache) {
          logSchedulerPerf("fetchSchedules:cache-hit", startedAt, {
            workspaceId,
            from,
            to,
            count: current.schedules.length,
          });
          return;
        }
        // 워크스페이스가 다르면 캐시를 비우고 시작 (다른 워크스페이스 데이터 노출 방지)
        if (current.cachedWorkspaceId !== workspaceId) {
          set({ schedules: [], cachedWorkspaceId: workspaceId });
        }
        // loading을 true로 올리지 않음 — 기존 캐시로 화면이 이미 그려진 상태 유지
        try {
          await reconcileSchedulerWorkspaceFromServer(workspaceId);
        } catch (error) {
          console.warn("[scheduler] 서버 스냅샷 대조 실패", error);
        }
        // LC 워크스페이스 진입 시 보호 DB 3종(작업·마일스톤·피처) 모두 보장
        await Promise.all([
          ensureLCSchedulerDatabase(workspaceId),
          ensureLCMilestoneDatabase(workspaceId),
          ensureLCFeatureDatabase(workspaceId),
        ]);
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
          const pageId = parseScheduleInstanceId(s.id)?.pageId;
          if (pageId) {
            const nextForPage = projectSchedulesForPage(input.workspaceId, pageId, rangeFrom, rangeTo);
            set((state) => {
              const schedules = replaceSchedulesForPages(
                state.schedules.filter((schedule) => schedule.id !== optimistic.id),
                new Set([pageId]),
                nextForPage,
              );
              if (schedules === state.schedules && state.cachedWorkspaceId === input.workspaceId) return state;
              return {
                schedules,
                cachedWorkspaceId: input.workspaceId,
              };
            });
          } else {
            set({
              schedules: projectSchedulesForStore(input.workspaceId, rangeFrom, rangeTo),
              cachedWorkspaceId: input.workspaceId,
            });
          }
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
          const pageId = parseScheduleInstanceId(input.id)?.pageId ?? parseScheduleInstanceId(s.id)?.pageId;
          if (pageId) {
            const nextForPage = projectSchedulesForPage(input.workspaceId, pageId, rangeFrom, rangeTo);
            set((state) => {
              const schedules = replaceSchedulesForPages(state.schedules, new Set([pageId]), nextForPage);
              if (schedules === state.schedules && state.cachedWorkspaceId === input.workspaceId) return state;
              return {
                schedules,
                cachedWorkspaceId: input.workspaceId,
              };
            });
          } else {
            set({
              schedules: projectSchedulesForStore(input.workspaceId, rangeFrom, rangeTo),
              cachedWorkspaceId: input.workspaceId,
            });
          }
          return s;
        } catch (error) {
          set({ schedules: previousSchedules, cachedWorkspaceId: input.workspaceId });
          throw error;
        }
      },

      deleteSchedule: async (id, workspaceId) => {
        const previousSchedules = get().schedules;
        const pageId = parseScheduleInstanceId(id)?.pageId ?? null;
        set((st) => ({
          schedules: pageId
            ? replaceSchedulesForPages(st.schedules, new Set([pageId]), [])
            : st.schedules.filter((x) => x.id !== id),
        }));
        const rangeFrom = get().visibleRangeFrom ?? undefined;
        const rangeTo = get().visibleRangeTo ?? undefined;
        try {
          await deleteLCSchedulerSchedule(id, workspaceId);
          if (pageId) {
            set((state) => {
              const schedules = replaceSchedulesForPages(state.schedules, new Set([pageId]), []);
              if (schedules === state.schedules && state.cachedWorkspaceId === workspaceId) return state;
              return {
                schedules,
                cachedWorkspaceId: workspaceId,
              };
            });
          } else {
            set({
              schedules: projectSchedulesForStore(workspaceId, rangeFrom, rangeTo),
              cachedWorkspaceId: workspaceId,
            });
          }
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

      refreshSchedulePageFromLocal: (pageId, workspaceId) => {
        get().refreshSchedulePagesFromLocal([pageId], workspaceId);
      },

      refreshSchedulePagesFromLocal: (pageIds, workspaceId) => {
        const startedAt = nowSchedulerPerf();
        const uniquePageIds = new Set(Array.from(pageIds).filter(Boolean));
        if (uniquePageIds.size === 0) return;
        const targetWorkspaceId = workspaceId ?? get().cachedWorkspaceId;
        if (!targetWorkspaceId) return;
        const rangeFrom = get().visibleRangeFrom ?? undefined;
        const rangeTo = get().visibleRangeTo ?? undefined;
        const nextForPages = Array.from(uniquePageIds).flatMap((pageId) =>
          projectSchedulesForPage(targetWorkspaceId, pageId, rangeFrom, rangeTo),
        );
        set((state) => {
          const schedules = replaceSchedulesForPages(state.schedules, uniquePageIds, nextForPages);
          if (schedules === state.schedules && state.cachedWorkspaceId === targetWorkspaceId) return state;
          return {
            schedules,
            cachedWorkspaceId: targetWorkspaceId,
          };
        });
        logSchedulerPerf("refreshSchedulePagesFromLocal", startedAt, {
          workspaceId: targetWorkspaceId,
          from: rangeFrom,
          to: rangeTo,
          pageCount: uniquePageIds.size,
          projectedCount: nextForPages.length,
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
      storage: deferredSchedulerStorage,
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
