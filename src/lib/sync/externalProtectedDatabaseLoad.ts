import { useDatabaseStore } from "../../store/databaseStore";
import { useDatabaseRowRemoteStore } from "../../store/databaseRowRemoteStore";
import { usePageStore } from "../../store/pageStore";
import {
  LC_FEATURE_DATABASE_ID,
  LC_MILESTONE_DATABASE_ID,
  LC_SCHEDULER_DATABASE_ID,
  isLCFeatureDatabaseId,
  isLCMilestoneDatabaseId,
  isLCSchedulerDatabaseId,
  isProtectedDatabaseId,
} from "../scheduler/database";
import { LC_SCHEDULER_WORKSPACE_ID } from "../scheduler/scope";
import { useSchedulerViewStore } from "../../store/schedulerViewStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import {
  fetchDatabaseById,
  fetchDatabaseRowIndexBatch,
  fetchDatabaseRowsBatch,
  fetchDatabasesByWorkspace,
  fetchPagesByWorkspace,
} from "./bootstrap";
import type { GqlDatabaseRowIndexPage, GqlPage } from "./graphql/operations";
import { applyRemoteDatabasesToStore, applyRemotePagesToStore } from "./storeApply";
import { refreshWorkspaceSnapshot } from "./workspaceSwitch";
import { gqlPageToDatabaseRowIndexEntry } from "../database/databaseRowIndexCache";
import { useDatabaseRowIndexStore } from "../../store/databaseRowIndexStore";
import {
  databaseCandidateFromGql,
  rememberCrossWorkspaceDatabaseRows,
} from "../crossWorkspaceSearch";

const DEFAULT_ROW_BATCH_LIMIT = 100;
const BACKGROUND_ROW_INDEX_BATCH_LIMIT = 200;

/** schedulerViewStore 선택값 → listDatabaseRows scope 인자(org/team/project/assignee). */
type DatabaseRowScope = {
  organizationId?: string;
  teamId?: string;
  projectId?: string;
  assigneeId?: string;
};

/**
 * 현재 스케줄러 뷰 선택(selectedProjectId / selectedMemberId)을 서버 scope 인자로 변환한다.
 * selectedProjectId 는 "org:{id}" | "team:{id}" | "proj:{id}" | (접두사 없는 projectId) 형식.
 */
function resolveCurrentDatabaseRowScope(): DatabaseRowScope {
  const { selectedProjectId, selectedMemberId } = useSchedulerViewStore.getState();
  const scope: DatabaseRowScope = {};
  if (selectedProjectId) {
    if (selectedProjectId.startsWith("org:")) {
      scope.organizationId = selectedProjectId.slice("org:".length);
    } else if (selectedProjectId.startsWith("team:")) {
      scope.teamId = selectedProjectId.slice("team:".length);
    } else if (selectedProjectId.startsWith("proj:")) {
      scope.projectId = selectedProjectId.slice("proj:".length);
    } else {
      scope.projectId = selectedProjectId;
    }
  }
  if (selectedMemberId) scope.assigneeId = selectedMemberId;
  return scope;
}

/** scope 를 in-flight/nextToken/완료판정 맵 키로 안정 직렬화. scope 없으면 빈 문자열. */
function scopeKey(scope: DatabaseRowScope): string {
  const parts: string[] = [];
  if (scope.organizationId) parts.push(`o:${scope.organizationId}`);
  if (scope.teamId) parts.push(`t:${scope.teamId}`);
  if (scope.projectId) parts.push(`p:${scope.projectId}`);
  if (scope.assigneeId) parts.push(`m:${scope.assigneeId}`);
  return parts.join("|");
}

/** resolvedDatabaseId + scope 복합키 — scope 별로 로드 상태를 분리한다. */
function compositeKey(resolvedDatabaseId: string, scope: DatabaseRowScope): string {
  const key = scopeKey(scope);
  return key ? `${resolvedDatabaseId}|${key}` : resolvedDatabaseId;
}

function hasScope(scope: DatabaseRowScope): boolean {
  return Boolean(
    scope.organizationId || scope.teamId || scope.projectId || scope.assigneeId,
  );
}

/**
 * 행 로드 컨텍스트 — 전역 스케줄러 필터(org/team/project/멤버)를 적용할지 결정한다.
 * - "scheduler": LC 스케줄러 모달/타임라인. schedulerViewStore 의 현재 선택을 scope 로 적용.
 * - "inline": 인라인 DB 블록·풀페이지·피크 등. scope 없이(전체) 로드해 전역 필터에 끌려가지 않게 한다.
 * 기본값을 "inline"(scope 없음=전체)으로 두어, 누락(under-fetch)이 아니라 과다(over-fetch)가
 * 안전한 실패 모드가 되도록 한다. 스케줄러 경로만 명시적으로 "scheduler" 로 opt-in 한다.
 */
export type DatabaseRowLoadContext = "scheduler" | "inline";

type EnsureExternalProtectedDatabaseLoadedArgs = {
  databaseId: string;
  currentWorkspaceId: string | null;
  cancelled?: () => boolean;
  rowLimit?: number;
  source?: string;
  loadContext?: DatabaseRowLoadContext;
};

type DatabaseRowLoadTarget = {
  resolvedDatabaseId: string;
  workspaceId: string;
  scope: DatabaseRowScope;
  protectedDatabase: boolean;
};

const inFlightByDatabaseId = new Map<string, Promise<boolean>>();
const inFlightMoreByDatabaseId = new Map<string, Promise<boolean>>();
const inFlightWarmIndexByDatabaseId = new Map<string, Promise<void>>();
const completedLoadDatabaseIds = new Set<string>();
const completedLoadLimitsByDatabaseId = new Map<string, number>();

export function resolveExternalProtectedDatabaseId(databaseId: string | null | undefined): string | null {
  if (!isProtectedDatabaseId(databaseId)) return null;
  if (isLCSchedulerDatabaseId(databaseId)) return LC_SCHEDULER_DATABASE_ID;
  if (isLCMilestoneDatabaseId(databaseId)) return LC_MILESTONE_DATABASE_ID;
  if (isLCFeatureDatabaseId(databaseId)) return LC_FEATURE_DATABASE_ID;
  return databaseId ?? null;
}

function resolveDatabaseRowLoadTarget(
  databaseId: string | null | undefined,
  currentWorkspaceId: string | null,
  loadContext: DatabaseRowLoadContext = "inline",
): DatabaseRowLoadTarget | null {
  if (!databaseId) return null;
  const protectedDatabaseId = resolveExternalProtectedDatabaseId(databaseId);
  if (protectedDatabaseId) {
    return {
      resolvedDatabaseId: protectedDatabaseId,
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
      // 스케줄러 모달에서만 전역 org/team/project/멤버 필터를 scope 로 적용한다.
      // 인라인 DB 블록·풀페이지·피크는 scope 없이(전체) 로드해 전역 필터 누락을 막는다.
      scope: loadContext === "scheduler" ? resolveCurrentDatabaseRowScope() : {},
      protectedDatabase: true,
    };
  }
  const databaseWorkspaceId =
    useDatabaseStore.getState().databases[databaseId]?.meta.workspaceId ?? currentWorkspaceId;
  if (!databaseWorkspaceId) return null;
  return {
    resolvedDatabaseId: databaseId,
    workspaceId: databaseWorkspaceId,
    scope: {},
    protectedDatabase: false,
  };
}

export function resolveDatabaseRowRemoteKey(
  databaseId: string | null | undefined,
  currentWorkspaceId: string | null,
  loadContext: DatabaseRowLoadContext = "inline",
): string | null {
  const target = resolveDatabaseRowLoadTarget(databaseId, currentWorkspaceId, loadContext);
  return target ? compositeKey(target.resolvedDatabaseId, target.scope) : null;
}

export function databaseRowsAreCached(databaseId: string | null | undefined): boolean {
  const resolvedDatabaseId = resolveExternalProtectedDatabaseId(databaseId) ?? databaseId;
  if (!resolvedDatabaseId) return false;
  const bundle = useDatabaseStore.getState().databases[resolvedDatabaseId];
  if (!bundle || bundle.rowPageOrder.length === 0) return false;
  const pages = usePageStore.getState().pages;
  return bundle.rowPageOrder.every((pageId) => {
    const page = pages[pageId];
    return Boolean(page) && page!.contentLoaded !== false;
  });
}

export function protectedDatabaseRowsAreCached(databaseId: string | null | undefined): boolean {
  if (!resolveExternalProtectedDatabaseId(databaseId)) return false;
  return databaseRowsAreCached(databaseId);
}

function databaseBundleIsEmpty(databaseId: string): boolean {
  const bundle = useDatabaseStore.getState().databases[databaseId];
  return Boolean(bundle && bundle.rowPageOrder.length === 0);
}

function databaseRowIndexConfirmsEmpty(loadKey: string): boolean {
  const snapshot = useDatabaseRowIndexStore.getState().snapshotsByKey[loadKey];
  return Boolean(snapshot?.complete && snapshot.rows.length === 0);
}

function databaseBundleIsConfirmedEmpty(databaseId: string, loadKey: string): boolean {
  return databaseBundleIsEmpty(databaseId) && databaseRowIndexConfirmsEmpty(loadKey);
}

function shouldUseCrossWorkspaceRowMerge(workspaceId: string, protectedDatabase: boolean): boolean {
  if (protectedDatabase) return false;
  return workspaceId !== useWorkspaceStore.getState().currentWorkspaceId;
}

function isSchemaUnavailableError(error: unknown): boolean {
  let text =
    error instanceof Error
      ? `${error.message}\n${error.stack ?? ""}`
      : "";
  if (!text) {
    try {
      text = JSON.stringify(error);
    } catch {
      text = String(error);
    }
  }
  const schemaValidationError =
    text.includes("Cannot query field") ||
    text.includes("Unknown field") ||
    text.includes("Validation error") ||
    text.includes("FieldUndefined");
  return (
    schemaValidationError &&
    (text.includes("getDatabase") || text.includes("listDatabaseRows"))
  );
}

function toRowIndexEntries(
  rows: readonly (GqlPage | GqlDatabaseRowIndexPage)[],
  resolvedDatabaseId: string,
) {
  return rows
    .map((row) => gqlPageToDatabaseRowIndexEntry(row, resolvedDatabaseId))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
}

function upsertRowIndexRows(args: {
  loadKey: string;
  resolvedDatabaseId: string;
  rows: readonly (GqlPage | GqlDatabaseRowIndexPage)[];
  complete: boolean;
  reset?: boolean;
}): void {
  const entries = toRowIndexEntries(args.rows, args.resolvedDatabaseId);
  if (entries.length === 0 && !args.reset) return;
  void useDatabaseRowIndexStore.getState().upsertRows(
    args.loadKey,
    args.resolvedDatabaseId,
    entries,
    { complete: args.complete, reset: args.reset },
  );
}

function warmDatabaseRowIndexInBackground(args: {
  loadKey: string;
  resolvedDatabaseId: string;
  workspaceId: string;
  scope: DatabaseRowScope;
  firstRows: readonly GqlPage[];
  firstNextToken: string | null;
  source: string;
}): void {
  if (hasScope(args.scope) || !args.firstNextToken) return;
  if (inFlightWarmIndexByDatabaseId.has(args.loadKey)) return;

  const task = (async () => {
    const allRows: Array<GqlPage | GqlDatabaseRowIndexPage> = [...args.firstRows];
    let nextToken: string | null = args.firstNextToken;
    const seenTokens = new Set<string>();
    let repeatedToken = false;
    while (nextToken) {
      if (seenTokens.has(nextToken)) {
        repeatedToken = true;
        break;
      }
      seenTokens.add(nextToken);
      const batch = await fetchDatabaseRowIndexBatch({
        workspaceId: args.workspaceId,
        databaseId: args.resolvedDatabaseId,
        limit: BACKGROUND_ROW_INDEX_BATCH_LIMIT,
        nextToken,
      });
      allRows.push(...batch.items);
      nextToken = batch.nextToken ?? null;
      useDatabaseRowRemoteStore.getState().setNextToken(args.loadKey, nextToken);
      upsertRowIndexRows({
        loadKey: args.loadKey,
        resolvedDatabaseId: args.resolvedDatabaseId,
        rows: batch.items,
        complete: !nextToken,
      });
    }
    upsertRowIndexRows({
      loadKey: args.loadKey,
      resolvedDatabaseId: args.resolvedDatabaseId,
      rows: allRows,
      complete: !nextToken && !repeatedToken,
      reset: true,
    });
    if (!nextToken && !repeatedToken) {
      completedLoadDatabaseIds.add(args.loadKey);
      completedLoadLimitsByDatabaseId.set(args.loadKey, allRows.length);
    }
  })().catch((_error) => {
    // 백그라운드 row-index 워밍 실패 — 무시
  }).finally(() => {
    inFlightWarmIndexByDatabaseId.delete(args.loadKey);
  });

  inFlightWarmIndexByDatabaseId.set(args.loadKey, task);
}

async function loadDatabaseRowIndexFallback(args: {
  loadKey: string;
  resolvedDatabaseId: string;
  workspaceId: string;
  scope: DatabaseRowScope;
  source: string;
}): Promise<boolean> {
  try {
    const rows = await fetchDatabaseRowIndexBatch({
      workspaceId: args.workspaceId,
      databaseId: args.resolvedDatabaseId,
      ...args.scope,
      limit: BACKGROUND_ROW_INDEX_BATCH_LIMIT,
    });
    useDatabaseRowRemoteStore.getState().setNextToken(args.loadKey, rows.nextToken ?? null);
    upsertRowIndexRows({
      loadKey: args.loadKey,
      resolvedDatabaseId: args.resolvedDatabaseId,
      rows: rows.items,
      complete: !rows.nextToken,
      reset: true,
    });
    return rows.items.length > 0;
  } catch {
    return false;
  }
}

async function loadLegacyFullProtectedDatabaseSnapshot(args: {
  databaseId: string;
  resolvedDatabaseId: string;
  currentWorkspaceId: string | null;
  workspaceId: string;
  protectedDatabase: boolean;
  cancelled?: () => boolean;
  source: string;
}): Promise<boolean> {
  const [pages, databases] = await Promise.all([
    fetchPagesByWorkspace(args.workspaceId),
    fetchDatabasesByWorkspace(args.workspaceId),
  ]);
  if (args.cancelled?.()) return false;
  const database = databases.find((item) => item.id === args.resolvedDatabaseId);
  if (!database) return false;
  if (shouldUseCrossWorkspaceRowMerge(args.workspaceId, args.protectedDatabase)) {
    const candidate = databaseCandidateFromGql(database);
    if (!candidate) return false;
    rememberCrossWorkspaceDatabaseRows(candidate, pages);
  } else {
    applyRemotePagesToStore(pages);
    applyRemoteDatabasesToStore([database]);
  }
  useDatabaseRowRemoteStore.getState().setNextToken(args.resolvedDatabaseId, null);
  if (!shouldUseCrossWorkspaceRowMerge(args.workspaceId, args.protectedDatabase)) {
    refreshWorkspaceSnapshot(args.workspaceId);
  }
  const resolved = databaseRowsAreCached(args.resolvedDatabaseId);
  return resolved;
}

export async function ensureExternalProtectedDatabaseLoaded({
  databaseId,
  currentWorkspaceId,
  cancelled,
  rowLimit = DEFAULT_ROW_BATCH_LIMIT,
  source = "unknown",
  loadContext = "inline",
}: EnsureExternalProtectedDatabaseLoadedArgs): Promise<boolean> {
  return ensureDatabaseRowsLoaded({
    databaseId,
    currentWorkspaceId,
    cancelled,
    rowLimit,
    source,
    loadContext,
  });
}

export async function ensureDatabaseRowsLoaded({
  databaseId,
  currentWorkspaceId,
  cancelled,
  rowLimit = DEFAULT_ROW_BATCH_LIMIT,
  source = "unknown",
  loadContext = "inline",
}: EnsureExternalProtectedDatabaseLoadedArgs): Promise<boolean> {
  const target = resolveDatabaseRowLoadTarget(databaseId, currentWorkspaceId, loadContext);
  if (!target) return false;
  const { resolvedDatabaseId, workspaceId, scope, protectedDatabase } = target;
  const scoped = hasScope(scope);
  const loadKey = compositeKey(resolvedDatabaseId, scope);
  const rowRemoteState = useDatabaseRowRemoteStore.getState();
  const rowPaginationKnown = Object.prototype.hasOwnProperty.call(
    rowRemoteState.nextTokenByDatabaseId,
    loadKey,
  );
  const cachedNextToken = rowRemoteState.nextTokenByDatabaseId[loadKey] ?? null;
  const completedLoadLimit = completedLoadLimitsByDatabaseId.get(loadKey) ?? 0;

  // scope 미지정(전체 로드)일 때만 로컬 캐시 완료 판정으로 재로드를 건너뛴다.
  // 단, row pagination 상태가 아직 없거나 nextToken 이 남아 있으면 전체 후보군 확인 전이므로 조회한다.
  // scope 지정 시 캐시 완료 판정이 과복잡하므로 "scope 1회 로드"(session 가드)로 단순화해 무한로드를 막는다.
  if (
    !scoped &&
    rowPaginationKnown &&
    databaseRowsAreCached(resolvedDatabaseId) &&
    cachedNextToken === null
  ) {
    return false;
  }
  if (
    completedLoadDatabaseIds.has(loadKey) &&
    completedLoadLimit >= rowLimit &&
    (
      scoped ||
      databaseRowsAreCached(resolvedDatabaseId) ||
      databaseBundleIsConfirmedEmpty(resolvedDatabaseId, loadKey)
    )
  ) {
    return false;
  }

  const existing = inFlightByDatabaseId.get(loadKey);
  if (existing) return existing;

  const task = (async () => {
    const [database, rows] = await Promise.all([
      fetchDatabaseById(workspaceId, resolvedDatabaseId),
      fetchDatabaseRowsBatch({
        workspaceId,
        databaseId: resolvedDatabaseId,
        ...scope,
        limit: rowLimit,
      }),
    ]);
    if (cancelled?.()) return false;
    if (!database) {
      return false;
    }

    if (shouldUseCrossWorkspaceRowMerge(workspaceId, protectedDatabase)) {
      const candidate = databaseCandidateFromGql(database);
      if (!candidate) return false;
      rememberCrossWorkspaceDatabaseRows(candidate, rows.items);
    } else {
      applyRemotePagesToStore(rows.items);
      applyRemoteDatabasesToStore([database]);
    }
    useDatabaseRowRemoteStore.getState().setNextToken(loadKey, rows.nextToken ?? null);
    upsertRowIndexRows({
      loadKey,
      resolvedDatabaseId,
      rows: rows.items,
      complete: !rows.nextToken,
    });
    const rowIndexFallbackResolved =
      rows.items.length === 0 && !rows.nextToken
        ? await loadDatabaseRowIndexFallback({
            loadKey,
            resolvedDatabaseId,
            workspaceId,
            scope,
            source,
          })
        : false;
    warmDatabaseRowIndexInBackground({
      loadKey,
      resolvedDatabaseId,
      workspaceId,
      scope,
      firstRows: rows.items,
      firstNextToken: rows.nextToken ?? null,
      source,
    });
    if (!shouldUseCrossWorkspaceRowMerge(workspaceId, protectedDatabase)) {
      refreshWorkspaceSnapshot(workspaceId);
    }

    const resolved =
      scoped || databaseRowsAreCached(resolvedDatabaseId) || rowIndexFallbackResolved;
    completedLoadDatabaseIds.add(loadKey);
    completedLoadLimitsByDatabaseId.set(loadKey, rowLimit);
    return resolved;
  })().catch(async (error) => {
    if (isSchemaUnavailableError(error)) {
      return await loadLegacyFullProtectedDatabaseSnapshot({
        databaseId,
        resolvedDatabaseId,
        currentWorkspaceId,
        workspaceId,
        protectedDatabase,
        cancelled,
        source,
      });
    }
    return false;
  }).finally(() => {
    inFlightByDatabaseId.delete(loadKey);
  });

  inFlightByDatabaseId.set(loadKey, task);
  return task;
}

export async function loadMoreExternalProtectedDatabaseRows(args: {
  databaseId: string;
  currentWorkspaceId: string | null;
  rowLimit?: number;
  source?: string;
  loadContext?: DatabaseRowLoadContext;
}): Promise<boolean> {
  return loadMoreDatabaseRows(args);
}

export async function loadMoreDatabaseRows(args: {
  databaseId: string;
  currentWorkspaceId: string | null;
  rowLimit?: number;
  source?: string;
  loadContext?: DatabaseRowLoadContext;
}): Promise<boolean> {
  const target = resolveDatabaseRowLoadTarget(
    args.databaseId,
    args.currentWorkspaceId,
    args.loadContext ?? "inline",
  );
  if (!target) return false;
  const { resolvedDatabaseId, workspaceId, scope, protectedDatabase } = target;
  const loadKey = compositeKey(resolvedDatabaseId, scope);
  const store = useDatabaseRowRemoteStore.getState();
  const nextToken = store.nextTokenByDatabaseId[loadKey];
  if (!nextToken) return false;
  const existing = inFlightMoreByDatabaseId.get(loadKey);
  if (existing) return existing;

  const rowLimit = args.rowLimit ?? DEFAULT_ROW_BATCH_LIMIT;
  const task = (async () => {
    store.setLoading(loadKey, true);
    const rows = await fetchDatabaseRowsBatch({
      workspaceId,
      databaseId: resolvedDatabaseId,
      ...scope,
      limit: rowLimit,
      nextToken,
    });
    if (shouldUseCrossWorkspaceRowMerge(workspaceId, protectedDatabase)) {
      const existing = useDatabaseStore.getState().databases[resolvedDatabaseId];
      if (existing) {
        rememberCrossWorkspaceDatabaseRows(
          {
            id: resolvedDatabaseId,
            workspaceId,
            meta: existing.meta,
            columns: existing.columns,
          },
          rows.items,
        );
      }
    } else {
      applyRemotePagesToStore(rows.items);
    }
    useDatabaseRowRemoteStore.getState().setNextToken(loadKey, rows.nextToken ?? null);
    upsertRowIndexRows({
      loadKey,
      resolvedDatabaseId,
      rows: rows.items,
      complete: !rows.nextToken,
    });
    if (!shouldUseCrossWorkspaceRowMerge(workspaceId, protectedDatabase)) {
      refreshWorkspaceSnapshot(workspaceId);
    }
    return rows.items.length > 0;
  })().catch(() => {
    return false;
  }).finally(() => {
    useDatabaseRowRemoteStore.getState().setLoading(loadKey, false);
    inFlightMoreByDatabaseId.delete(loadKey);
  });

  inFlightMoreByDatabaseId.set(loadKey, task);
  return task;
}

export function __resetExternalProtectedDatabaseLoadForTests(): void {
  resetDatabaseRowLoadSessionState();
  useDatabaseRowRemoteStore.getState().clear();
  useDatabaseRowIndexStore.setState({
    snapshotsByKey: {},
    hydratedByKey: {},
    loadingByKey: {},
  });
}

export function resetDatabaseRowLoadSessionState(): void {
  inFlightByDatabaseId.clear();
  inFlightMoreByDatabaseId.clear();
  inFlightWarmIndexByDatabaseId.clear();
  completedLoadDatabaseIds.clear();
  completedLoadLimitsByDatabaseId.clear();
}
