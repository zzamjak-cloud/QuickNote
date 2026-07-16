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
import { useOrganizationStore } from "./organizationStore";
import { useSchedulerProjectsStore } from "./schedulerProjectsStore";
import { useSchedulerViewStore } from "./schedulerViewStore";
import { useTeamStore } from "./teamStore";
import { filterSchedulesByRange, scheduleOverlapsRange } from "../lib/scheduler/selectors/scheduleSelectors";
import { logSchedulerPerf, nowSchedulerPerf } from "../lib/scheduler/performance";
import { makeDeferredStorage } from "../lib/storage/index";

const deferredSchedulerStorage = makeDeferredStorage();
import { fetchDatabasesByWorkspace, fetchPagesByWorkspace } from "../lib/sync/bootstrap";
import type { GqlSchedule } from "../lib/sync/graphql/operations";
import { getSyncEngine } from "../lib/sync/runtime";
import { applyRemotePagesToStore, reconcileLCSchedulerRemoteSnapshot } from "../lib/sync/storeApply";
import {
  extractScheduleRangeSourcePages,
  fetchScheduleRange,
  type ScheduleRangeRequest,
} from "../lib/sync/scheduleRangeApi";
import {
  readSchedulerReconcileWatermark,
  resolveNextSchedulerReconcileWatermark,
  writeSchedulerReconcileWatermark,
} from "../lib/scheduler/schedulerReconcileCache";
import { parseSchedulerScopeKey, resolveVisibleSchedulerMembers } from "../lib/scheduler/scopeMembers";

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
  colorScope?: "row" | "card";
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
  /** 마지막으로 캐시된 스코프 키 (team:xxx / org:xxx / projectId / null) */
  cachedScopeKey: string | null;
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

function gqlScheduleToSchedule(schedule: GqlSchedule): Schedule {
  return {
    id: schedule.id,
    workspaceId: schedule.workspaceId,
    title: schedule.title,
    comment: schedule.comment ?? null,
    link: schedule.link ?? null,
    kind: schedule.kind === "leave" ? "leave" : "schedule",
    projectId: schedule.projectId ?? null,
    teamId: schedule.teamId ?? null,
    organizationId: schedule.organizationId ?? null,
    startAt: schedule.startAt,
    endAt: schedule.endAt,
    assigneeId: schedule.assigneeId ?? null,
    color: schedule.color ?? null,
    textColor: schedule.textColor ?? null,
    rowIndex: schedule.rowIndex ?? 0,
    createdByMemberId: schedule.createdByMemberId,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
  };
}

function mergeSchedulesById(primary: Schedule[], secondary: Schedule[]): Schedule[] {
  if (secondary.length === 0) return primary;
  const seen = new Set(primary.map((schedule) => schedule.id));
  const merged = [...primary];
  for (const schedule of secondary) {
    if (seen.has(schedule.id)) continue;
    seen.add(schedule.id);
    merged.push(schedule);
  }
  return merged;
}

function mergeGqlSchedulesById(schedules: GqlSchedule[]): GqlSchedule[] {
  const seen = new Set<string>();
  const merged: GqlSchedule[] = [];
  for (const schedule of schedules) {
    if (seen.has(schedule.id)) continue;
    seen.add(schedule.id);
    merged.push(schedule);
  }
  return merged;
}

function isPageBackedLCSchedulerRecord(schedule: GqlSchedule): boolean {
  const parsed = parseScheduleInstanceId(schedule.id);
  if (!parsed) return false;
  if (!schedule.sourcePageId || schedule.sourcePageId !== parsed.pageId) return false;
  const sourcePage = schedule.sourcePage;
  if (!sourcePage || sourcePage.id !== parsed.pageId) return false;
  if (sourcePage.deletedAt) return false;
  return true;
}

function makeSchedulerRangeCacheKey(
  scopeKey: string | null,
  assigneeId: string | null,
  selectedJobTitle: string | null,
): string {
  return JSON.stringify({
    scopeKey,
    assigneeId,
    selectedJobTitle,
    pageBackedOnly: 1,
  });
}

function dedupeScheduleRangeRequests(requests: ScheduleRangeRequest[]): ScheduleRangeRequest[] {
  const seen = new Set<string>();
  const deduped: ScheduleRangeRequest[] = [];
  for (const request of requests) {
    const key = [
      request.organizationId ?? "",
      request.teamId ?? "",
      request.projectId ?? "",
      request.assigneeId ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(request);
  }
  return deduped;
}

function buildSchedulerRangeRequests(args: {
  workspaceId: string;
  from: string;
  to: string;
  scopeKey: string | null;
  assigneeId: string | null;
  selectedJobTitle: string | null;
}): ScheduleRangeRequest[] {
  const { workspaceId, from, to, scopeKey, assigneeId, selectedJobTitle } = args;
  const base = {
    workspaceId,
    from,
    to,
  };
  const scopedIds = parseSchedulerScopeKey(scopeKey);
  const requests: ScheduleRangeRequest[] = [];

  if (scopeKey) {
    requests.push({
      ...base,
      ...scopedIds,
      assigneeId: null,
    });
  }

  if (assigneeId) {
    requests.push({
      ...base,
      organizationId: null,
      teamId: null,
      projectId: null,
      assigneeId,
    });
    return dedupeScheduleRangeRequests(requests);
  }

  if (!scopeKey) {
    requests.push({
      ...base,
      organizationId: null,
      teamId: null,
      projectId: null,
      assigneeId: null,
    });
    return requests;
  }

  const memberState = useMemberStore.getState();
  const memberIds = resolveVisibleSchedulerMembers({
    members: memberState.members,
    memberCacheWorkspaceId: memberState.cacheWorkspaceId,
    organizations: useOrganizationStore.getState().organizations,
    organizationCacheWorkspaceId: useOrganizationStore.getState().cacheWorkspaceId,
    teams: useTeamStore.getState().teams,
    teamCacheWorkspaceId: useTeamStore.getState().cacheWorkspaceId,
    projects: useSchedulerProjectsStore.getState().projects,
    projectCacheWorkspaceId: useSchedulerProjectsStore.getState().workspaceId,
    selectedScopeKey: scopeKey,
    selectedJobTitle,
  }).map((member) => member.memberId);

  for (const memberId of memberIds) {
    requests.push({
      ...base,
      organizationId: null,
      teamId: null,
      projectId: null,
      assigneeId: memberId,
    });
  }

  return dedupeScheduleRangeRequests(requests);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await mapper(item);
    }
  }));
  return results;
}

async function fetchSchedulerRangeForCurrentScope(args: {
  workspaceId: string;
  from: string;
  to: string;
  scopeKey: string | null;
  assigneeId: string | null;
  selectedJobTitle: string | null;
}): Promise<GqlSchedule[]> {
  const requests = buildSchedulerRangeRequests(args);
  const groups = await mapWithConcurrency(requests, 6, fetchScheduleRange);
  return mergeGqlSchedulesById(groups.flat().filter(isPageBackedLCSchedulerRecord));
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

async function reconcileSchedulerWorkspaceFromServer(workspaceId: string): Promise<void> {
  if (workspaceId !== LC_SCHEDULER_WORKSPACE_ID) return;
  if (!schedulerRemoteReconcileInFlight) {
    schedulerRemoteReconcileInFlight = (async () => {
      const engine = await getSyncEngine();
      await engine.flush();
      const updatedAfter = await readSchedulerReconcileWatermark(workspaceId);
      if (!updatedAfter) {
        await writeSchedulerReconcileWatermark(workspaceId, new Date().toISOString());
        return;
      }
      // 증분(updatedAfter)만 가져와 적용한다. 삭제는 deltaPages 의 deletedAt 으로 전파되고,
      // 실시간 구독(onPageChanged)·scoped 조회(fetchScheduleRange)가 추가로 보장한다.
      // "전체 목록을 받아 없는 것을 prune" 하는 방식은 scoped/부분 로딩과 양립 불가이므로 쓰지 않는다.
      const [pages, databases] = await Promise.all([
        fetchPagesByWorkspace(LC_SCHEDULER_WORKSPACE_ID, updatedAfter),
        fetchDatabasesByWorkspace(LC_SCHEDULER_WORKSPACE_ID, updatedAfter),
      ]);
      reconcileLCSchedulerRemoteSnapshot({ pages, databases });
      const nextWatermark = resolveNextSchedulerReconcileWatermark(updatedAfter, pages, databases);
      if (nextWatermark && nextWatermark !== updatedAfter) {
        await writeSchedulerReconcileWatermark(workspaceId, nextWatermark);
      }
    })().finally(() => {
      schedulerRemoteReconcileInFlight = null;
    });
  }
  await schedulerRemoteReconcileInFlight;
}

// 생성 직후 아직 페이지/서버에 반영되지 않은 낙관적 카드 id —
// 백그라운드 재검증(SWR)의 set 이 이 카드를 지우지 않도록 보존한다.
// (Ctrl+드래그 생성 → 새 일정 피커 열림 구간에서 카드가 사라지던 회귀 방지)
const inFlightOptimisticScheduleIds = new Set<string>();

/**
 * 현재 뷰 스코프(프로젝트/팀/조직 탭·선택 구성원·직군)에 맞는 일정만 남긴다 — 클라 유효값 기준.
 *
 * 서버 scoped listSchedules 는 인덱스 기록 시점의 raw 셀만 필터하므로, 파생/상속
 * (columnSource 자동화·pageLink 미러)으로만 스코프가 정해진 행을 영구 누락한다.
 * 따라서 범위 조회는 항상 unscoped 로 받고, 스코프 판정은 유효값을 가진 투영 결과에
 * 이 필터를 적용해 수행한다. 의미론은 기존 서버 요청 구성과 동일:
 * "스코프 일치 일정 ∪ (스코프의) 보이는 구성원에게 배정된 일정".
 */
function filterSchedulesForCurrentScope(
  schedules: Schedule[],
  args: {
    scopeKey: string | null;
    assigneeId: string | null;
    selectedJobTitle: string | null;
  },
): Schedule[] {
  const { scopeKey, assigneeId, selectedJobTitle } = args;
  if (!scopeKey && !assigneeId) return schedules;

  const scope = parseSchedulerScopeKey(scopeKey);
  const matchesScope = (schedule: Schedule): boolean =>
    Boolean(
      (scope.organizationId && schedule.organizationId === scope.organizationId) ||
      (scope.teamId && schedule.teamId === scope.teamId) ||
      (scope.projectId && schedule.projectId === scope.projectId),
    );

  // 구성원 선택 뷰 — 해당 구성원 배정분 + (스코프 선택 시) 스코프 일치 일정
  if (assigneeId) {
    return schedules.filter(
      (schedule) => schedule.assigneeId === assigneeId || matchesScope(schedule),
    );
  }

  const memberState = useMemberStore.getState();
  const visibleMemberIds = new Set(
    resolveVisibleSchedulerMembers({
      members: memberState.members,
      memberCacheWorkspaceId: memberState.cacheWorkspaceId,
      organizations: useOrganizationStore.getState().organizations,
      organizationCacheWorkspaceId: useOrganizationStore.getState().cacheWorkspaceId,
      teams: useTeamStore.getState().teams,
      teamCacheWorkspaceId: useTeamStore.getState().cacheWorkspaceId,
      projects: useSchedulerProjectsStore.getState().projects,
      projectCacheWorkspaceId: useSchedulerProjectsStore.getState().workspaceId,
      selectedScopeKey: scopeKey,
      selectedJobTitle,
    }).map((member) => member.memberId),
  );
  return schedules.filter(
    (schedule) =>
      matchesScope(schedule) ||
      Boolean(schedule.assigneeId && visibleMemberIds.has(schedule.assigneeId)),
  );
}

// 동일 키(워크스페이스+범위+스코프)의 서버 재검증 중복 실행 방지
let schedulerRevalidationKey: string | null = null;
let schedulerRevalidationInFlight: Promise<void> | null = null;

function runSchedulerRevalidation(
  key: string,
  revalidate: () => Promise<void>,
): Promise<void> {
  if (schedulerRevalidationInFlight && schedulerRevalidationKey === key) {
    return schedulerRevalidationInFlight;
  }
  schedulerRevalidationKey = key;
  schedulerRevalidationInFlight = revalidate().finally(() => {
    if (schedulerRevalidationKey === key) {
      schedulerRevalidationKey = null;
      schedulerRevalidationInFlight = null;
    }
  });
  return schedulerRevalidationInFlight;
}

export const useSchedulerStore = create<SchedulerStore>()(
  persist(
    (set, get) => ({
      schedules: [],
      loading: false,
      cachedWorkspaceId: null,
      visibleRangeFrom: null,
      visibleRangeTo: null,
      cachedScopeKey: null,

      fetchSchedules: async (workspaceId, from, to) => {
        const startedAt = nowSchedulerPerf();
        const { selectedProjectId, selectedMemberId, selectedJobTitle } = useSchedulerViewStore.getState();
        const scopeKey = selectedProjectId ?? null;
        const assigneeId = selectedMemberId ?? null;
        const cacheScopeKey = makeSchedulerRangeCacheKey(scopeKey, assigneeId, selectedJobTitle ?? null);
        const current = get();

        // 서버 권위 데이터로 캐시를 갱신하는 본체. cache-hit 시에도 백그라운드로 실행된다(SWR).
        const revalidate = async () => {
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
          let remoteProjected: Schedule[] | null = null;
          if (workspaceId === LC_SCHEDULER_WORKSPACE_ID) {
            try {
              // 서버 scoped 쿼리는 raw 셀 기준이라 파생(상속) 스코프 행을 놓친다 —
              // 항상 범위 전체(unscoped)를 받고 스코프 판정은 아래 클라 유효값 필터가 수행.
              const rangeSchedules = await fetchSchedulerRangeForCurrentScope({
                workspaceId,
                from,
                to,
                scopeKey: null,
                assigneeId: null,
                selectedJobTitle: null,
              });
              const sourcePages = extractScheduleRangeSourcePages(rangeSchedules);
              applyRemotePagesToStore(sourcePages);
              remoteProjected = rangeSchedules.map(gqlScheduleToSchedule);
            } catch (error) {
              console.warn("[scheduler] 범위 일정 조회 실패", error);
            }
          }
          // 모든 await 이후(마지막 순간)에 로컬을 투영한다 — 재검증이 도는 동안
          // 생성/편집된 행이 이른 시점 투영에서 누락되는 레이스 방지.
          // 로컬 투영이 유효값(파생 스코프 포함)을 가지므로 우선하고, 로컬 store 에
          // 아직 없는 원격 레코드만 보충한다. local-only 일정은 절대 드롭되지 않는다.
          const localProjected = projectSchedulesForStore(workspaceId, from, to);
          const combined = remoteProjected
            ? mergeSchedulesById(localProjected, remoteProjected)
            : localProjected;
          const scoped = filterSchedulesForCurrentScope(combined, {
            scopeKey,
            assigneeId,
            selectedJobTitle: selectedJobTitle ?? null,
          });
          // 생성 진행 중(서버 미반영) 낙관적 카드는 재검증 결과에 없어도 유지한다.
          const preservedOptimistic = get().schedules.filter(
            (schedule) =>
              inFlightOptimisticScheduleIds.has(schedule.id) &&
              !scoped.some((s) => s.id === schedule.id),
          );
          const schedules =
            preservedOptimistic.length > 0 ? [...scoped, ...preservedOptimistic] : scoped;
          set({
            schedules,
            cachedWorkspaceId: workspaceId,
            visibleRangeFrom: from,
            visibleRangeTo: to,
            cachedScopeKey: cacheScopeKey,
            loading: false,
          });
          logSchedulerPerf("fetchSchedules:project-visible-range", startedAt, {
            workspaceId,
            from,
            to,
            count: get().schedules.length,
          });
        };
        const revalidationKey = `${workspaceId}|${from}|${to}|${cacheScopeKey}`;

        const hasSameVisibleCache =
          current.cachedWorkspaceId === workspaceId &&
          current.visibleRangeFrom === from &&
          current.visibleRangeTo === to &&
          current.cachedScopeKey === cacheScopeKey &&
          // 빈 schedules 캐시는 cache-hit 으로 막지 않는다.
          // (과거 망가진 시점에 persist 된 빈 배열이 영구히 재계산을 차단하던 회귀 방지 —
          //  page store 에 행이 있어도 빈 캐시로 early-return 하면 카드가 안 보였음)
          current.schedules.length > 0;
        if (hasSameVisibleCache) {
          logSchedulerPerf("fetchSchedules:cache-hit", startedAt, {
            workspaceId,
            from,
            to,
            count: current.schedules.length,
          });
          // persist 된 stale 캐시가 다른 PC 의 새 일정을 영구 차단하지 않도록,
          // 캐시로 즉시 그린 뒤 백그라운드에서 서버 재검증으로 캐시를 갱신한다(SWR).
          void runSchedulerRevalidation(revalidationKey, revalidate);
          return;
        }
        // 워크스페이스가 다르면 캐시를 비우고 시작 (다른 워크스페이스 데이터 노출 방지)
        if (current.cachedWorkspaceId !== workspaceId) {
          set({ schedules: [], cachedWorkspaceId: workspaceId });
        }
        // loading을 true로 올리지 않음 — 기존 캐시로 화면이 이미 그려진 상태 유지
        await runSchedulerRevalidation(revalidationKey, revalidate);
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
          inFlightOptimisticScheduleIds.add(optimistic.id);
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
        } finally {
          inFlightOptimisticScheduleIds.delete(optimistic.id);
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
        cachedScopeKey: st.cachedScopeKey,
      }),
    },
  ),
);
