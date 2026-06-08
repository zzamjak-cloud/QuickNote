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

type EnsureExternalProtectedDatabaseLoadedArgs = {
  databaseId: string;
  currentWorkspaceId: string | null;
  cancelled?: () => boolean;
  rowLimit?: number;
  source?: string;
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
): DatabaseRowLoadTarget | null {
  if (!databaseId) return null;
  const protectedDatabaseId = resolveExternalProtectedDatabaseId(databaseId);
  if (protectedDatabaseId) {
    return {
      resolvedDatabaseId: protectedDatabaseId,
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
      scope: resolveCurrentDatabaseRowScope(),
      protectedDatabase: true,
    };
  }
  if (!currentWorkspaceId) return null;
  return {
    resolvedDatabaseId: databaseId,
    workspaceId: currentWorkspaceId,
    scope: {},
    protectedDatabase: false,
  };
}

export function resolveDatabaseRowRemoteKey(
  databaseId: string | null | undefined,
  currentWorkspaceId: string | null,
): string | null {
  const target = resolveDatabaseRowLoadTarget(databaseId, currentWorkspaceId);
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

function databaseRowsMeetRequestedLimit(databaseId: string, rowLimit: number): boolean {
  const bundle = useDatabaseStore.getState().databases[databaseId];
  return Boolean(bundle && bundle.rowPageOrder.length >= rowLimit);
}

export function protectedDatabaseRowsAreCached(databaseId: string | null | undefined): boolean {
  if (!resolveExternalProtectedDatabaseId(databaseId)) return false;
  return databaseRowsAreCached(databaseId);
}

function databaseBundleIsEmpty(databaseId: string): boolean {
  const bundle = useDatabaseStore.getState().databases[databaseId];
  return Boolean(bundle && bundle.rowPageOrder.length === 0);
}

function devLog(event: string, payload: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  console.info(`[QN_EXTERNAL_DB] ${event}`, payload);
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
      devLog("row-index-warm-batch", {
        databaseId: args.resolvedDatabaseId,
        loadKey: args.loadKey,
        rowCount: batch.items.length,
        nextTokenAvailable: Boolean(nextToken),
        source: args.source,
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
  })().catch((error) => {
    console.warn("[QN_EXTERNAL_DB] row-index-warm-failed", {
      databaseId: args.resolvedDatabaseId,
      loadKey: args.loadKey,
      source: args.source,
      error,
    });
  }).finally(() => {
    inFlightWarmIndexByDatabaseId.delete(args.loadKey);
  });

  inFlightWarmIndexByDatabaseId.set(args.loadKey, task);
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
  devLog("legacy-full-fallback-start", {
    databaseId: args.databaseId,
    resolvedDatabaseId: args.resolvedDatabaseId,
    currentWorkspaceId: args.currentWorkspaceId,
    workspaceId: args.workspaceId,
    protectedDatabase: args.protectedDatabase,
    source: args.source,
  });
  const [pages, databases] = await Promise.all([
    fetchPagesByWorkspace(args.workspaceId),
    fetchDatabasesByWorkspace(args.workspaceId),
  ]);
  if (args.cancelled?.()) return false;
  const database = databases.find((item) => item.id === args.resolvedDatabaseId);
  if (!database) return false;
  applyRemotePagesToStore(pages);
  applyRemoteDatabasesToStore([database]);
  useDatabaseRowRemoteStore.getState().setNextToken(args.resolvedDatabaseId, null);
  refreshWorkspaceSnapshot(args.workspaceId);
  const resolved = databaseRowsAreCached(args.resolvedDatabaseId);
  devLog("legacy-full-fallback-applied", {
    databaseId: args.databaseId,
    resolvedDatabaseId: args.resolvedDatabaseId,
    currentWorkspaceId: args.currentWorkspaceId,
    workspaceId: args.workspaceId,
    protectedDatabase: args.protectedDatabase,
    rowCount: pages.filter((page) => page.databaseId === args.resolvedDatabaseId).length,
    resolved,
    source: args.source,
  });
  return resolved;
}

export async function ensureExternalProtectedDatabaseLoaded({
  databaseId,
  currentWorkspaceId,
  cancelled,
  rowLimit = DEFAULT_ROW_BATCH_LIMIT,
  source = "unknown",
}: EnsureExternalProtectedDatabaseLoadedArgs): Promise<boolean> {
  return ensureDatabaseRowsLoaded({
    databaseId,
    currentWorkspaceId,
    cancelled,
    rowLimit,
    source,
  });
}

export async function ensureDatabaseRowsLoaded({
  databaseId,
  currentWorkspaceId,
  cancelled,
  rowLimit = DEFAULT_ROW_BATCH_LIMIT,
  source = "unknown",
}: EnsureExternalProtectedDatabaseLoadedArgs): Promise<boolean> {
  const target = resolveDatabaseRowLoadTarget(databaseId, currentWorkspaceId);
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
  const cachedRowsMeetRequestedLimit = databaseRowsMeetRequestedLimit(
    resolvedDatabaseId,
    rowLimit,
  );
  const completedLoadLimit = completedLoadLimitsByDatabaseId.get(loadKey) ?? 0;

  // scope 미지정(전체 로드)일 때만 로컬 캐시 완료 판정으로 재로드를 건너뛴다.
  // 단, row pagination 상태가 아직 없으면 서버 nextToken 확인 전이므로 한 번은 조회한다.
  // scope 지정 시 캐시 완료 판정이 과복잡하므로 "scope 1회 로드"(session 가드)로 단순화해 무한로드를 막는다.
  if (
    !scoped &&
    rowPaginationKnown &&
    databaseRowsAreCached(resolvedDatabaseId) &&
    (cachedNextToken === null || cachedRowsMeetRequestedLimit)
  ) {
    devLog("skip", {
      databaseId,
      resolvedDatabaseId,
      scope: scopeKey(scope),
      currentWorkspaceId,
      workspaceId,
      protectedDatabase,
      reason: "local-cache-complete",
      cachedNextTokenAvailable: Boolean(cachedNextToken),
      cachedRowsMeetRequestedLimit,
      rowLimit,
      source,
    });
    return false;
  }
  if (
    completedLoadDatabaseIds.has(loadKey) &&
    completedLoadLimit >= rowLimit &&
    (scoped || databaseRowsAreCached(resolvedDatabaseId) || databaseBundleIsEmpty(resolvedDatabaseId))
  ) {
    devLog("skip", {
      databaseId,
      resolvedDatabaseId,
      scope: scopeKey(scope),
      currentWorkspaceId,
      workspaceId,
      protectedDatabase,
      reason: "session-load-complete",
      completedLoadLimit,
      rowLimit,
      source,
    });
    return false;
  }

  const existing = inFlightByDatabaseId.get(loadKey);
  if (existing) return existing;

  const task = (async () => {
    devLog("load-start", {
      databaseId,
      resolvedDatabaseId,
      scope: scopeKey(scope),
      currentWorkspaceId,
      workspaceId,
      protectedDatabase,
      rowLimit,
      source,
    });
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
      devLog("load-missing-database", {
        databaseId,
        resolvedDatabaseId,
        scope: scopeKey(scope),
        currentWorkspaceId,
        workspaceId,
        protectedDatabase,
        source,
      });
      return false;
    }

    applyRemotePagesToStore(rows.items);
    applyRemoteDatabasesToStore([database]);
    useDatabaseRowRemoteStore.getState().setNextToken(loadKey, rows.nextToken ?? null);
    upsertRowIndexRows({
      loadKey,
      resolvedDatabaseId,
      rows: rows.items,
      complete: !rows.nextToken,
    });
    warmDatabaseRowIndexInBackground({
      loadKey,
      resolvedDatabaseId,
      workspaceId,
      scope,
      firstRows: rows.items,
      firstNextToken: rows.nextToken ?? null,
      source,
    });
    refreshWorkspaceSnapshot(workspaceId);

    const resolved = scoped ? true : databaseRowsAreCached(resolvedDatabaseId);
    completedLoadDatabaseIds.add(loadKey);
    completedLoadLimitsByDatabaseId.set(loadKey, rowLimit);
    devLog("load-applied", {
      databaseId,
      resolvedDatabaseId,
      scope: scopeKey(scope),
      currentWorkspaceId,
      workspaceId,
      protectedDatabase,
      rowCount: rows.items.length,
      nextTokenAvailable: Boolean(rows.nextToken),
      resolved,
      source,
    });
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
    console.warn("[QN_EXTERNAL_DB] load-failed", {
      databaseId,
      resolvedDatabaseId,
      scope: scopeKey(scope),
      currentWorkspaceId,
      workspaceId,
      protectedDatabase,
      source,
      error,
    });
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
}): Promise<boolean> {
  return loadMoreDatabaseRows(args);
}

export async function loadMoreDatabaseRows(args: {
  databaseId: string;
  currentWorkspaceId: string | null;
  rowLimit?: number;
  source?: string;
}): Promise<boolean> {
  const target = resolveDatabaseRowLoadTarget(args.databaseId, args.currentWorkspaceId);
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
    devLog("load-more-start", {
      databaseId: args.databaseId,
      resolvedDatabaseId,
      scope: scopeKey(scope),
      currentWorkspaceId: args.currentWorkspaceId,
      workspaceId,
      protectedDatabase,
      rowLimit,
      source: args.source ?? "unknown",
    });
    const rows = await fetchDatabaseRowsBatch({
      workspaceId,
      databaseId: resolvedDatabaseId,
      ...scope,
      limit: rowLimit,
      nextToken,
    });
    applyRemotePagesToStore(rows.items);
    useDatabaseRowRemoteStore.getState().setNextToken(loadKey, rows.nextToken ?? null);
    upsertRowIndexRows({
      loadKey,
      resolvedDatabaseId,
      rows: rows.items,
      complete: !rows.nextToken,
    });
    refreshWorkspaceSnapshot(workspaceId);
    devLog("load-more-applied", {
      databaseId: args.databaseId,
      resolvedDatabaseId,
      scope: scopeKey(scope),
      workspaceId,
      protectedDatabase,
      rowCount: rows.items.length,
      nextTokenAvailable: Boolean(rows.nextToken),
      source: args.source ?? "unknown",
    });
    return rows.items.length > 0;
  })().catch((error) => {
    console.warn("[QN_EXTERNAL_DB] load-more-failed", {
      databaseId: args.databaseId,
      resolvedDatabaseId,
      scope: scopeKey(scope),
      currentWorkspaceId: args.currentWorkspaceId,
      workspaceId,
      protectedDatabase,
      source: args.source ?? "unknown",
      error,
    });
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
