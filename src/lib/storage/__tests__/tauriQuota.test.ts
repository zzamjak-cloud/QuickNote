import { describe, expect, it } from "vitest";
import {
  normalizeTauriCacheRows,
  selectTauriCacheKeysToPrune,
  shouldCheckTauriPrune,
} from "../tauriQuota";

describe("tauri cache quota", () => {
  it("SQLite row의 snake_case metadata를 quota entry로 정규화한다", () => {
    expect(normalizeTauriCacheRows([
      { key: "quicknote.scheduler.cache.range.v1", size: 12, updated_at: 100 },
      { key: "quicknote.pages.v1", size: 999, updated_at: 1 },
    ])).toEqual([
      { key: "quicknote.scheduler.cache.range.v1", size: 12, updatedAt: 100 },
      { key: "quicknote.pages.v1", size: 999, updatedAt: 1 },
    ]);
  });

  it("Tauri pruning도 오래된 .cache. 키만 삭제 대상으로 고른다", () => {
    expect(selectTauriCacheKeysToPrune([
      { key: "quicknote.scheduler.cache.old.v1", size: 7, updated_at: 1 },
      { key: "quicknote.scheduler.cache.new.v1", size: 7, updated_at: 2 },
      { key: "quicknote.pages.v1", size: 100, updated_at: 0 },
    ], 10, 9)).toEqual(["quicknote.scheduler.cache.old.v1"]);
  });

  it("cache key write 횟수가 interval에 도달할 때만 prune 검사를 수행한다", () => {
    expect(shouldCheckTauriPrune("quicknote.scheduler.cache.range.v1", 23)).toBe(false);
    expect(shouldCheckTauriPrune("quicknote.scheduler.cache.range.v1", 24)).toBe(true);
    expect(shouldCheckTauriPrune("quicknote.pages.v1", 24)).toBe(false);
  });
});
