import { fetchDatabaseRowIndexBatch, fetchDatabasesByWorkspace, fetchPagesByWorkspace } from "./sync/bootstrap";
import type { GqlDatabase, GqlDatabaseRowIndexPage, GqlPage } from "./sync/graphql/operations";
import { usePageStore } from "../store/pageStore";
import { useDatabaseStore, listDatabases } from "../store/databaseStore";
import { useWorkspaceStore, type WorkspaceSummary } from "../store/workspaceStore";
import type { DatabaseBundle, DatabaseMeta, ColumnDef, CellValue } from "../types/database";
import type { Page } from "../types/page";
import { EMPTY_DOC } from "../store/pageStore/helpers";
import { parseAwsJson, gqlOrderNumber, isoToMs, gqlPageToLocalPage } from "./sync/storeApply/helpers";
import { tryParseSerializedColumns } from "./database/schema/normalizeDatabase";
import { readWorkspaceSnapshotPages } from "./sync/workspaceSwitch";
import { LC_SCHEDULER_WORKSPACE_ID } from "./scheduler/scope";
import { createLocalDeletionFilter } from "./sync/localDeleteGuards";
import { crossWorkspacePageCache as pageCache } from "./crossWorkspacePageCache";

export type CrossWorkspaceDatabaseCandidate = {
  id: string;
  workspaceId: string;
  meta: DatabaseMeta;
  columns: ColumnDef[];
};

const PUBLIC_CACHE_TTL_MS = 5 * 60 * 1000;
const ROW_CACHE_TTL_MS = 90 * 1000;

const databaseCache = new Map<string, { loadedAt: number; databases: CrossWorkspaceDatabaseCandidate[] }>();
const rowCache = new Map<string, { loadedAt: number; rows: Page[] }>();

function isFresh(loadedAt: number, ttl: number): boolean {
  return Date.now() - loadedAt < ttl;
}

export function isPublicCrossWorkspace(workspace: WorkspaceSummary): boolean {
  if (workspace.workspaceId === LC_SCHEDULER_WORKSPACE_ID) return false;
  if (workspace.type !== "shared" || workspace.removedAt) return false;
  return Boolean(
    workspace.access?.some(
      (entry) =>
        entry.subjectType === "everyone" &&
        (entry.level === "view" || entry.level === "edit"),
    ),
  );
}

function crossWorkspaceTargets(): WorkspaceSummary[] {
  const state = useWorkspaceStore.getState();
  const currentWorkspaceId = state.currentWorkspaceId;
  const seen = new Set<string>();
  const out: WorkspaceSummary[] = [];
  for (const workspace of state.workspaces) {
    const isCurrent = workspace.workspaceId === currentWorkspaceId;
    if (!isCurrent && !isPublicCrossWorkspace(workspace)) continue;
    if (workspace.removedAt || seen.has(workspace.workspaceId)) continue;
    seen.add(workspace.workspaceId);
    out.push(workspace);
  }
  return out;
}

function pageFromRow(row: GqlDatabaseRowIndexPage): Page {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title || "제목 없음",
    icon: row.icon ?? null,
    doc: structuredClone(EMPTY_DOC),
    parentId: null,
    order: gqlOrderNumber(row),
    createdAt: isoToMs(row.createdAt),
    updatedAt: isoToMs(row.updatedAt),
    databaseId: row.databaseId ?? undefined,
    dbCells: parseAwsJson<Record<string, CellValue> | undefined>(row.dbCells, undefined),
    contentLoaded: false,
  };
}

function localPages(): Page[] {
  const currentWorkspaceId = useWorkspaceStore.getState().currentWorkspaceId;
  return Object.values(usePageStore.getState().pages).filter((page) => {
    if ((page as { deletedAt?: string | null }).deletedAt) return false;
    if (!currentWorkspaceId || !page.workspaceId) return true;
    return page.workspaceId === currentWorkspaceId;
  });
}

function localDatabases(): CrossWorkspaceDatabaseCandidate[] {
  const state = useDatabaseStore.getState();
  return listDatabases(state).map(({ id, meta }) => ({
    id,
    workspaceId: meta.workspaceId ?? useWorkspaceStore.getState().currentWorkspaceId ?? "",
    meta,
    columns: state.databases[id]?.columns ?? [],
  }));
}

export function databaseCandidateFromGql(db: GqlDatabase): CrossWorkspaceDatabaseCandidate | null {
  if (db.deletedAt) return null;
  const columns = tryParseSerializedColumns(db.columns);
  if (!columns) return null;
  return {
    id: db.id,
    workspaceId: db.workspaceId,
    meta: {
      id: db.id,
      workspaceId: db.workspaceId,
      title: db.title || "제목 없음",
      createdAt: isoToMs(db.createdAt),
      updatedAt: isoToMs(db.updatedAt),
    },
    columns,
  };
}

async function loadPublicPagesForWorkspace(workspaceId: string): Promise<Page[]> {
  const cached = pageCache.get(workspaceId);
  if (cached && isFresh(cached.loadedAt, PUBLIC_CACHE_TTL_MS)) return cached.pages;
  // 1) 워크스페이스 방문 시 적재된 스냅샷 캐시(메모리·persist)를 우선 사용 — 네트워크 없이 즉시.
  //    첫 멘션/링크 검색이 listPages 풀페치로 오래 걸리던 문제 해소. 스냅샷엔 DB 행 페이지도 포함된다.
  const snapshotPages = await readWorkspaceSnapshotPages(workspaceId);
  if (snapshotPages && snapshotPages.length > 0) {
    pageCache.set(workspaceId, { loadedAt: Date.now(), pages: snapshotPages });
    return snapshotPages;
  }
  // 2) 스냅샷이 없으면(미방문) listPages 로 일반 페이지+DB 행을 가져온다.
  //    listPageMetas 는 DB 행을 제외하므로 DB 중심 워크스페이스 후보가 0개가 되는 것을 피한다.
  const pages = (await fetchPagesByWorkspace(workspaceId)).map(gqlPageToLocalPage);
  pageCache.set(workspaceId, { loadedAt: Date.now(), pages });
  return pages;
}

async function loadPublicDatabasesForWorkspace(
  workspaceId: string,
): Promise<CrossWorkspaceDatabaseCandidate[]> {
  const cached = databaseCache.get(workspaceId);
  if (cached && isFresh(cached.loadedAt, PUBLIC_CACHE_TTL_MS)) return cached.databases;
  const databases = (await fetchDatabasesByWorkspace(workspaceId))
    .map(databaseCandidateFromGql)
    .filter((db): db is CrossWorkspaceDatabaseCandidate => Boolean(db));
  databaseCache.set(workspaceId, { loadedAt: Date.now(), databases });
  return databases;
}

function mergeUniquePages(pages: Page[]): Page[] {
  const seen = new Set<string>();
  const out: Page[] = [];
  for (const page of pages) {
    if (seen.has(page.id)) continue;
    seen.add(page.id);
    out.push(page);
  }
  return out;
}

function mergeUniqueDatabases(
  databases: CrossWorkspaceDatabaseCandidate[],
): CrossWorkspaceDatabaseCandidate[] {
  const seen = new Set<string>();
  const out: CrossWorkspaceDatabaseCandidate[] = [];
  for (const db of databases) {
    if (seen.has(db.id)) continue;
    seen.add(db.id);
    out.push(db);
  }
  return out;
}

// 외부 워크스페이스 후보 로딩은 워크스페이스별로 격리한다. 한 워크스페이스 조회가
// 실패(권한/네트워크)해도 로컬 + 나머지 공개 워크스페이스 후보는 그대로 노출돼야 한다.
async function settledFlat<T>(targets: WorkspaceSummary[], loader: (workspaceId: string) => Promise<T[]>): Promise<T[]> {
  const results = await Promise.allSettled(targets.map((workspace) => loader(workspace.workspaceId)));
  const out: T[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") out.push(...result.value);
  }
  return out;
}

export async function loadCrossWorkspacePageCandidates(): Promise<Page[]> {
  const currentWorkspaceId = useWorkspaceStore.getState().currentWorkspaceId;
  const externalTargets = crossWorkspaceTargets().filter(
    (workspace) => workspace.workspaceId !== currentWorkspaceId,
  );
  const externalPages = await settledFlat(externalTargets, loadPublicPagesForWorkspace);
  // 로컬 삭제된 페이지는 stale 캐시(스냅샷·pageCache)에 남아도 후보에서 제외한다.
  const isDeleted = createLocalDeletionFilter();
  return mergeUniquePages([...localPages(), ...externalPages]).filter(
    (page) => !isDeleted("page", page.id, page.workspaceId),
  );
}

export async function loadCrossWorkspaceDatabaseCandidates(): Promise<CrossWorkspaceDatabaseCandidate[]> {
  const currentWorkspaceId = useWorkspaceStore.getState().currentWorkspaceId;
  const externalTargets = crossWorkspaceTargets().filter(
    (workspace) => workspace.workspaceId !== currentWorkspaceId,
  );
  const externalDatabases = await settledFlat(externalTargets, loadPublicDatabasesForWorkspace);
  const isDeleted = createLocalDeletionFilter();
  return mergeUniqueDatabases([...localDatabases(), ...externalDatabases]).filter(
    (db) => !isDeleted("database", db.id, db.workspaceId),
  );
}

export async function loadCrossWorkspaceRowsForDatabase(databaseId: string): Promise<Page[]> {
  const local = localPages().filter((page) => page.databaseId === databaseId);
  if (local.length > 0) return local;
  const database = (await loadCrossWorkspaceDatabaseCandidates()).find((db) => db.id === databaseId);
  if (!database?.workspaceId) return [];
  const cacheKey = `${database.workspaceId}:${databaseId}`;
  const cached = rowCache.get(cacheKey);
  if (cached && isFresh(cached.loadedAt, ROW_CACHE_TTL_MS)) return cached.rows;

  const rows: Page[] = [];
  let nextToken: string | null = null;
  try {
    do {
      const batch = await fetchDatabaseRowIndexBatch({
        workspaceId: database.workspaceId,
        databaseId,
        limit: 200,
        nextToken,
      });
      rows.push(...batch.items.map(pageFromRow));
      nextToken = batch.nextToken ?? null;
    } while (nextToken);
  } catch {
    // 권한/네트워크 실패 시 부분 수집분만 반환(팝업 전체 비움 방지). 실패는 캐시하지 않는다.
    return rows;
  }
  rowCache.set(cacheKey, { loadedAt: Date.now(), rows });
  return rows;
}

export function rememberCrossWorkspacePages(pages: readonly Page[]): void {
  if (pages.length === 0) return;
  usePageStore.setState((state) => {
    let changed = false;
    const next = { ...state.pages };
    for (const page of pages) {
      const existing = next[page.id];
      if (existing?.contentLoaded) continue;
      next[page.id] = { ...(existing ?? page), ...page };
      changed = true;
    }
    return changed ? { pages: next } : state;
  });
}

export function rememberCrossWorkspaceDatabase(database: CrossWorkspaceDatabaseCandidate): void {
  useDatabaseStore.setState((state) => {
    const existing = state.databases[database.id];
    if (existing) return state;
    const bundle: DatabaseBundle = {
      meta: database.meta,
      columns: database.columns,
      rowPageOrder: [],
    };
    return {
      databases: {
        ...state.databases,
        [database.id]: bundle,
      },
    };
  });
}

export function rememberCrossWorkspaceDatabaseRows(
  database: CrossWorkspaceDatabaseCandidate,
  rows: readonly GqlPage[],
): void {
  const localRows = rows.map(gqlPageToLocalPage);
  rememberCrossWorkspaceDatabase(database);
  rememberCrossWorkspacePages(localRows);
  useDatabaseStore.setState((state) => {
    const existing = state.databases[database.id];
    const priorOrder = existing?.rowPageOrder ?? [];
    const seen = new Set(priorOrder);
    const rowPageOrder = [...priorOrder];
    for (const row of localRows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rowPageOrder.push(row.id);
    }
    return {
      databases: {
        ...state.databases,
        [database.id]: {
          meta: existing?.meta ?? database.meta,
          columns: existing?.columns ?? database.columns,
          presets: existing?.presets,
          panelState: existing?.panelState,
          rowPageOrder,
        },
      },
    };
  });
}
