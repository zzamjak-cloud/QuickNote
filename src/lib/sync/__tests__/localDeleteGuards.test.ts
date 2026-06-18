import { describe, it, expect, beforeEach } from "vitest";
import {
  markLocallyDeletedEntity,
  createLocalDeletionFilter,
} from "../localDeleteGuards";

// 검색/멘션 후보 빌더가 삭제된 항목을 거르기 위해 쓰는 필터.
// 삭제 후 stale 캐시가 삭제 항목을 계속 노출하던 회귀를 고정한다.

describe("createLocalDeletionFilter", () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
  });

  it("로컬 삭제된 페이지는 true(=숨김), 그 외는 false", () => {
    markLocallyDeletedEntity("page", "p1", "ws1");
    const isDeleted = createLocalDeletionFilter();
    expect(isDeleted("page", "p1", "ws1")).toBe(true);
    expect(isDeleted("page", "p2", "ws1")).toBe(false);
  });

  it("workspaceId 가 다르면 매칭하지 않는다", () => {
    markLocallyDeletedEntity("page", "p1", "ws1");
    const isDeleted = createLocalDeletionFilter();
    expect(isDeleted("page", "p1", "ws2")).toBe(false);
  });

  it("kind 가 다르면 매칭하지 않는다(database vs page)", () => {
    markLocallyDeletedEntity("database", "d1", "ws1");
    const isDeleted = createLocalDeletionFilter();
    expect(isDeleted("database", "d1", "ws1")).toBe(true);
    expect(isDeleted("page", "d1", "ws1")).toBe(false);
  });

  it("id/workspaceId 누락 시 false", () => {
    const isDeleted = createLocalDeletionFilter();
    expect(isDeleted("page", "", "ws1")).toBe(false);
    expect(isDeleted("page", "p1", null)).toBe(false);
    expect(isDeleted("page", "p1", undefined)).toBe(false);
  });
});
