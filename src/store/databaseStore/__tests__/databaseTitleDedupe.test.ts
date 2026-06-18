import { describe, it, expect } from "vitest";
import {
  isDatabaseTitleTaken,
  allocateUniqueDatabaseTitle,
} from "../helpers";
import type { DatabaseBundle } from "../../../types/database";

// 다른 워크스페이스의 DB(cross-workspace 검색용으로 remember 된 ghost 등)가
// 현재 워크스페이스 DB 의 이름을 잘못 점유하던 불일치를 고정한다.

function bundle(title: string, workspaceId?: string): DatabaseBundle {
  return {
    meta: {
      id: `db-${title}-${workspaceId ?? "none"}`,
      workspaceId,
      title,
      createdAt: 0,
      updatedAt: 0,
    },
    columns: [],
    rowPageOrder: [],
  };
}

describe("isDatabaseTitleTaken (워크스페이스 스코핑)", () => {
  const dbs = {
    a: bundle("보고서", "ws1"),
    b: bundle("회의록", "ws2"),
  };

  it("같은 워크스페이스의 동일 이름은 충돌", () => {
    expect(isDatabaseTitleTaken(dbs, "보고서", "", "ws1")).toBe(true);
  });

  it("다른 워크스페이스의 동일 이름은 충돌 아님", () => {
    // "회의록" 은 ws2 에만 있으므로 ws1 에서 만들 때 충돌하면 안 된다.
    expect(isDatabaseTitleTaken(dbs, "회의록", "", "ws1")).toBe(false);
  });

  it("workspaceId 미지정 시 전체 스캔(기존 동작 보존)", () => {
    expect(isDatabaseTitleTaken(dbs, "회의록", "")).toBe(true);
  });

  it("workspaceId 없는 레거시 DB 는 스코핑돼도 충돌 대상에 포함", () => {
    const withLegacy = { ...dbs, c: bundle("연감") };
    expect(isDatabaseTitleTaken(withLegacy, "연감", "", "ws1")).toBe(true);
  });
});

describe("allocateUniqueDatabaseTitle (워크스페이스 스코핑)", () => {
  it("다른 워크스페이스 동일 이름은 suffix 없이 그대로 사용", () => {
    const dbs = { a: bundle("보고서", "ws2") };
    expect(allocateUniqueDatabaseTitle(dbs, "보고서", "ws1")).toBe("보고서");
  });

  it("같은 워크스페이스 동일 이름은 (2) suffix", () => {
    const dbs = { a: bundle("보고서", "ws1") };
    expect(allocateUniqueDatabaseTitle(dbs, "보고서", "ws1")).toBe("보고서 (2)");
  });
});
