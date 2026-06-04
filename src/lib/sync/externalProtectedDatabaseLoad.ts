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
import {
  fetchDatabaseById,
  fetchDatabaseRowsBatch,
  fetchDatabasesByWorkspace,
  fetchPagesByWorkspace,
} from "./bootstrap";
import { applyRemoteDatabasesToStore, applyRemotePagesToStore } from "./storeApply";
import { refreshWorkspaceSnapshot } from "./workspaceSwitch";

const DEFAULT_ROW_BATCH_LIMIT = 100;

type EnsureExternalProtectedDatabaseLoadedArgs = {
  databaseId: string;
  currentWorkspaceId: string | null;
  cancelled?: () => boolean;
  rowLimit?: number;
  source?: string;
};

const inFlightByDatabaseId = new Map<string, Promise<boolean>>();
const inFlightMoreByDatabaseId = new Map<string, Promise<boolean>>();
const completedLoadDatabaseIds = new Set<string>();

export function resolveExternalProtectedDatabaseId(databaseId: string | null | undefined): string | null {
  if (!isProtectedDatabaseId(databaseId)) return null;
  if (isLCSchedulerDatabaseId(databaseId)) return LC_SCHEDULER_DATABASE_ID;
  if (isLCMilestoneDatabaseId(databaseId)) return LC_MILESTONE_DATABASE_ID;
  if (isLCFeatureDatabaseId(databaseId)) return LC_FEATURE_DATABASE_ID;
  return databaseId ?? null;
}

export function protectedDatabaseRowsAreCached(databaseId: string | null | undefined): boolean {
  const resolvedDatabaseId = resolveExternalProtectedDatabaseId(databaseId);
  if (!resolvedDatabaseId) return false;
  const bundle = useDatabaseStore.getState().databases[resolvedDatabaseId];
  if (!bundle || bundle.rowPageOrder.length === 0) return false;
  const pages = usePageStore.getState().pages;
  // 메타 baseline 은 row 를 dbCells 없이(contentLoaded=false) 적재한다.
  // 페이지 존재만으로 "캐시 완료"로 보면 셀이 빈 row 가 표시되므로, 콘텐츠 적재까지 요구한다.
  return bundle.rowPageOrder.every((pageId) => {
    const page = pages[pageId];
    return Boolean(page) && page.contentLoaded !== false;
  });
}

function protectedDatabaseBundleIsEmpty(databaseId: string): boolean {
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

async function loadLegacyFullProtectedDatabaseSnapshot(args: {
  databaseId: string;
  resolvedDatabaseId: string;
  currentWorkspaceId: string;
  cancelled?: () => boolean;
  source: string;
}): Promise<boolean> {
  devLog("legacy-full-fallback-start", {
    databaseId: args.databaseId,
    resolvedDatabaseId: args.resolvedDatabaseId,
    currentWorkspaceId: args.currentWorkspaceId,
    source: args.source,
  });
  const [pages, databases] = await Promise.all([
    fetchPagesByWorkspace(LC_SCHEDULER_WORKSPACE_ID),
    fetchDatabasesByWorkspace(LC_SCHEDULER_WORKSPACE_ID),
  ]);
  if (args.cancelled?.()) return false;
  const database = databases.find((item) => item.id === args.resolvedDatabaseId);
  if (!database) return false;
  applyRemotePagesToStore(pages);
  applyRemoteDatabasesToStore([database]);
  useDatabaseRowRemoteStore.getState().setNextToken(args.resolvedDatabaseId, null);
  refreshWorkspaceSnapshot(LC_SCHEDULER_WORKSPACE_ID);
  const resolved = protectedDatabaseRowsAreCached(args.resolvedDatabaseId);
  devLog("legacy-full-fallback-applied", {
    databaseId: args.databaseId,
    resolvedDatabaseId: args.resolvedDatabaseId,
    currentWorkspaceId: args.currentWorkspaceId,
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
  const resolvedDatabaseId = resolveExternalProtectedDatabaseId(databaseId);
  if (!resolvedDatabaseId) return false;
  // 홈 워크스페이스(LC 스케줄러) 내부에서도 로드한다 — 메타 baseline 은 row 콘텐츠(dbCells)를
  // 내려받지 않으므로, 워크스페이스 스냅샷에 의존하지 않고 listDatabaseRows 로 직접 적재한다.
  if (!currentWorkspaceId) return false;
  if (protectedDatabaseRowsAreCached(resolvedDatabaseId)) {
    devLog("skip", {
      databaseId,
      resolvedDatabaseId,
      currentWorkspaceId,
      reason: "local-cache-complete",
      source,
    });
    return false;
  }
  if (completedLoadDatabaseIds.has(resolvedDatabaseId) && protectedDatabaseBundleIsEmpty(resolvedDatabaseId)) {
    devLog("skip", {
      databaseId,
      resolvedDatabaseId,
      currentWorkspaceId,
      reason: "session-load-complete",
      source,
    });
    return false;
  }

  const existing = inFlightByDatabaseId.get(resolvedDatabaseId);
  if (existing) return existing;

  const task = (async () => {
    devLog("load-start", {
      databaseId,
      resolvedDatabaseId,
      currentWorkspaceId,
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
      rowLimit,
      source,
    });
    const [database, rows] = await Promise.all([
      fetchDatabaseById(LC_SCHEDULER_WORKSPACE_ID, resolvedDatabaseId),
      fetchDatabaseRowsBatch({
        workspaceId: LC_SCHEDULER_WORKSPACE_ID,
        databaseId: resolvedDatabaseId,
        limit: rowLimit,
      }),
    ]);
    if (cancelled?.()) return false;
    if (!database) {
      devLog("load-missing-database", {
        databaseId,
        resolvedDatabaseId,
        currentWorkspaceId,
        source,
      });
      return false;
    }

    applyRemotePagesToStore(rows.items);
    applyRemoteDatabasesToStore([database]);
    useDatabaseRowRemoteStore.getState().setNextToken(resolvedDatabaseId, rows.nextToken ?? null);
    refreshWorkspaceSnapshot(LC_SCHEDULER_WORKSPACE_ID);

    const resolved = protectedDatabaseRowsAreCached(resolvedDatabaseId);
    completedLoadDatabaseIds.add(resolvedDatabaseId);
    devLog("load-applied", {
      databaseId,
      resolvedDatabaseId,
      currentWorkspaceId,
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
        cancelled,
        source,
      });
    }
    console.warn("[QN_EXTERNAL_DB] load-failed", {
      databaseId,
      resolvedDatabaseId,
      currentWorkspaceId,
      source,
      error,
    });
    return false;
  }).finally(() => {
    inFlightByDatabaseId.delete(resolvedDatabaseId);
  });

  inFlightByDatabaseId.set(resolvedDatabaseId, task);
  return task;
}

export async function loadMoreExternalProtectedDatabaseRows(args: {
  databaseId: string;
  currentWorkspaceId: string | null;
  rowLimit?: number;
  source?: string;
}): Promise<boolean> {
  const resolvedDatabaseId = resolveExternalProtectedDatabaseId(args.databaseId);
  if (!resolvedDatabaseId) return false;
  if (!args.currentWorkspaceId) return false;
  const store = useDatabaseRowRemoteStore.getState();
  const nextToken = store.nextTokenByDatabaseId[resolvedDatabaseId];
  if (!nextToken) return false;
  const existing = inFlightMoreByDatabaseId.get(resolvedDatabaseId);
  if (existing) return existing;

  const rowLimit = args.rowLimit ?? DEFAULT_ROW_BATCH_LIMIT;
  const task = (async () => {
    store.setLoading(resolvedDatabaseId, true);
    devLog("load-more-start", {
      databaseId: args.databaseId,
      resolvedDatabaseId,
      currentWorkspaceId: args.currentWorkspaceId,
      rowLimit,
      source: args.source ?? "unknown",
    });
    const rows = await fetchDatabaseRowsBatch({
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
      databaseId: resolvedDatabaseId,
      limit: rowLimit,
      nextToken,
    });
    applyRemotePagesToStore(rows.items);
    useDatabaseRowRemoteStore.getState().setNextToken(resolvedDatabaseId, rows.nextToken ?? null);
    refreshWorkspaceSnapshot(LC_SCHEDULER_WORKSPACE_ID);
    devLog("load-more-applied", {
      databaseId: args.databaseId,
      resolvedDatabaseId,
      rowCount: rows.items.length,
      nextTokenAvailable: Boolean(rows.nextToken),
      source: args.source ?? "unknown",
    });
    return rows.items.length > 0;
  })().catch((error) => {
    console.warn("[QN_EXTERNAL_DB] load-more-failed", {
      databaseId: args.databaseId,
      resolvedDatabaseId,
      currentWorkspaceId: args.currentWorkspaceId,
      source: args.source ?? "unknown",
      error,
    });
    return false;
  }).finally(() => {
    useDatabaseRowRemoteStore.getState().setLoading(resolvedDatabaseId, false);
    inFlightMoreByDatabaseId.delete(resolvedDatabaseId);
  });

  inFlightMoreByDatabaseId.set(resolvedDatabaseId, task);
  return task;
}

export function __resetExternalProtectedDatabaseLoadForTests(): void {
  inFlightByDatabaseId.clear();
  inFlightMoreByDatabaseId.clear();
  completedLoadDatabaseIds.clear();
  useDatabaseRowRemoteStore.getState().clear();
}
