import type { CellValue } from "../../types/database";
import type { GqlDatabaseRowIndexPage, GqlPage } from "../sync/graphql/operations";
import {
  gqlOrderNumber,
  isoToMs,
  parseAwsJson,
} from "../sync/storeApply/helpers";
import { zustandStorage } from "../storage/index";

export const DATABASE_ROW_INDEX_CACHE_VERSION = 1;

export type DatabaseRowIndexEntry = {
  pageId: string;
  workspaceId: string;
  databaseId: string;
  title: string;
  icon: string | null;
  order: number;
  dbCells?: Record<string, CellValue>;
  updatedAt: number;
};

export type DatabaseRowIndexSnapshot = {
  v: number;
  indexKey: string;
  databaseId: string;
  complete: boolean;
  updatedAt: number;
  rows: DatabaseRowIndexEntry[];
};

type DatabaseRowIndexRemotePage = GqlPage | GqlDatabaseRowIndexPage;

function cacheKey(indexKey: string): string {
  return `quicknote.database-row-index.cache.${encodeURIComponent(indexKey)}.v${DATABASE_ROW_INDEX_CACHE_VERSION}`;
}

export function normalizeDatabaseRowIndexRows(
  rows: readonly DatabaseRowIndexEntry[],
): DatabaseRowIndexEntry[] {
  const byPageId = new Map<string, DatabaseRowIndexEntry>();
  for (const row of rows) {
    const prev = byPageId.get(row.pageId);
    if (!prev || row.updatedAt >= prev.updatedAt) byPageId.set(row.pageId, row);
  }
  return Array.from(byPageId.values()).sort(
    (a, b) => a.order - b.order || a.pageId.localeCompare(b.pageId),
  );
}

export function gqlPageToDatabaseRowIndexEntry(
  page: DatabaseRowIndexRemotePage,
  fallbackDatabaseId: string,
): DatabaseRowIndexEntry | null {
  if (page.deletedAt) return null;
  const databaseId = page.databaseId ?? fallbackDatabaseId;
  if (!databaseId) return null;
  const dbCells = parseAwsJson<Record<string, CellValue> | undefined>(
    page.dbCells,
    undefined,
  );
  if (dbCells?.["_qn_isTemplate"] === "1") return null;
  return {
    pageId: page.id,
    workspaceId: page.workspaceId,
    databaseId,
    title: page.title,
    icon: page.icon ?? null,
    order: gqlOrderNumber(page),
    dbCells,
    updatedAt: isoToMs(page.updatedAt) || Date.now(),
  };
}

export async function readDatabaseRowIndexCache(
  indexKey: string,
): Promise<DatabaseRowIndexSnapshot | null> {
  try {
    const raw = await zustandStorage.getItem(cacheKey(indexKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DatabaseRowIndexSnapshot;
    if (
      parsed.v !== DATABASE_ROW_INDEX_CACHE_VERSION ||
      parsed.indexKey !== indexKey ||
      !Array.isArray(parsed.rows)
    ) {
      return null;
    }
    return {
      ...parsed,
      rows: normalizeDatabaseRowIndexRows(parsed.rows),
    };
  } catch {
    return null;
  }
}

export async function writeDatabaseRowIndexCache(
  snapshot: DatabaseRowIndexSnapshot,
): Promise<void> {
  try {
    await zustandStorage.setItem(
      cacheKey(snapshot.indexKey),
      JSON.stringify({
        ...snapshot,
        v: DATABASE_ROW_INDEX_CACHE_VERSION,
        rows: normalizeDatabaseRowIndexRows(snapshot.rows),
      }),
    );
  } catch {
    // 캐시 저장 실패는 화면 계산 실패로 취급하지 않는다.
  }
}

export async function removeDatabaseRowIndexCache(indexKey: string): Promise<void> {
  try {
    await zustandStorage.removeItem(cacheKey(indexKey));
  } catch {
    // 캐시 삭제 실패는 무시한다.
  }
}
