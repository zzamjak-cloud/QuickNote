import { describe, expect, it } from "vitest";
import {
  CACHE_HARD_LIMIT_BYTES,
  CACHE_PRUNE_TARGET_BYTES,
  isPrunableCacheKey,
  selectCacheKeysToPrune,
} from "../cacheQuota";

describe("cache quota", () => {
  it("웹앱과 로컬앱 캐시 한도를 10GB 기준으로 통일한다", () => {
    expect(CACHE_HARD_LIMIT_BYTES).toBe(10 * 1024 * 1024 * 1024);
    expect(CACHE_PRUNE_TARGET_BYTES).toBe(9 * 1024 * 1024 * 1024);
  });

  it("서버에서 재구성 가능한 cache 키만 prune 대상으로 본다", () => {
    expect(isPrunableCacheKey("quicknote.scheduler.cache.range.v1")).toBe(true);
    expect(isPrunableCacheKey("quicknote.pages.v1")).toBe(false);
    expect(isPrunableCacheKey("quicknote.sync.outbox.v1")).toBe(false);
  });

  it("한도를 넘으면 오래된 캐시부터 목표 용량까지 삭제 대상으로 고른다", () => {
    const gib = 1024 * 1024 * 1024;
    const keys = selectCacheKeysToPrune([
      { key: "quicknote.scheduler.cache.older.v1", size: 4 * gib, updatedAt: 10 },
      { key: "quicknote.scheduler.cache.middle.v1", size: 4 * gib, updatedAt: 20 },
      { key: "quicknote.scheduler.cache.newer.v1", size: 4 * gib, updatedAt: 30 },
      { key: "quicknote.pages.v1", size: 20 * gib, updatedAt: 1 },
    ]);

    expect(keys).toEqual([
      "quicknote.scheduler.cache.older.v1",
    ]);
  });
});
