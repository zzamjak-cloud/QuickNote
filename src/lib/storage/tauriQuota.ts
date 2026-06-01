import {
  type CacheQuotaEntry,
  isPrunableCacheKey,
  selectCacheKeysToPrune,
} from "./cacheQuota";

export const TAURI_PRUNE_CHECK_INTERVAL = 24;

export type TauriCacheRow = {
  key: string;
  size?: number | null;
  updated_at?: number | null;
};

export function normalizeTauriCacheRows(rows: TauriCacheRow[]): CacheQuotaEntry[] {
  return rows.map((row) => ({
    key: row.key,
    size: typeof row.size === "number" ? row.size : 0,
    updatedAt: typeof row.updated_at === "number" ? row.updated_at : 0,
  }));
}

export function selectTauriCacheKeysToPrune(
  rows: TauriCacheRow[],
  hardLimitBytes?: number,
  targetBytes?: number,
): string[] {
  return selectCacheKeysToPrune(
    normalizeTauriCacheRows(rows),
    hardLimitBytes,
    targetBytes,
  );
}

export function shouldCheckTauriPrune(key: string, writeCount: number): boolean {
  return isPrunableCacheKey(key) && writeCount % TAURI_PRUNE_CHECK_INTERVAL === 0;
}
