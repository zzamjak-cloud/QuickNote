export const GIB_BYTES = 1024 * 1024 * 1024;
export const CACHE_HARD_LIMIT_BYTES = 10 * GIB_BYTES;
export const CACHE_PRUNE_TARGET_BYTES = 9 * GIB_BYTES;

export type CacheQuotaEntry = {
  key: string;
  size: number;
  updatedAt: number;
};

/**
 * 서버에서 다시 만들 수 있는 캐시만 자동 정리 대상에 포함한다.
 * 사용자 원본 데이터와 outbox는 이 조건에 들어오면 안 된다.
 */
export function isPrunableCacheKey(key: string): boolean {
  return key.startsWith("quicknote.") && key.includes(".cache.");
}

export function selectCacheKeysToPrune(
  entries: CacheQuotaEntry[],
  hardLimitBytes = CACHE_HARD_LIMIT_BYTES,
  targetBytes = CACHE_PRUNE_TARGET_BYTES,
): string[] {
  const prunable = entries.filter((entry) => isPrunableCacheKey(entry.key));
  let totalBytes = prunable.reduce((sum, entry) => sum + entry.size, 0);
  if (totalBytes <= hardLimitBytes) return [];

  const keysToDelete: string[] = [];
  const sorted = prunable.slice().sort((a, b) => a.updatedAt - b.updatedAt);
  for (const entry of sorted) {
    if (totalBytes <= targetBytes) break;
    totalBytes -= entry.size;
    keysToDelete.push(entry.key);
  }
  return keysToDelete;
}
