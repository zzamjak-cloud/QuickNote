import { describe, it, expect, beforeEach } from "vitest";
import { useDatabaseRowIndexStore } from "../databaseRowIndexStore";
import type { DatabaseRowIndexEntry } from "../../lib/database/databaseRowIndexCache";

// 페이지/행 삭제 시 행 인덱스 캐시에서 제거돼 fallback 유령 행이 안 남는지 고정.

function row(pageId: string): DatabaseRowIndexEntry {
  return {
    pageId,
    workspaceId: "ws1",
    databaseId: "db1",
    title: pageId,
    icon: null,
    order: 0,
    updatedAt: 1,
  };
}

describe("databaseRowIndexStore.removePagesFromAllIndexes", () => {
  beforeEach(() => {
    useDatabaseRowIndexStore.setState({
      snapshotsByKey: {},
      hydratedByKey: {},
      loadingByKey: {},
    });
  });

  it("모든 스냅샷에서 주어진 pageId 를 제거한다", async () => {
    const store = useDatabaseRowIndexStore.getState();
    await store.upsertRows("ws1:db1", "db1", [row("p1"), row("p2"), row("p3")], {
      reset: true,
    });
    await store.upsertRows("ws1:db2", "db2", [row("p2"), row("p4")], {
      reset: true,
    });

    await useDatabaseRowIndexStore.getState().removePagesFromAllIndexes(["p2"]);

    const snaps = useDatabaseRowIndexStore.getState().snapshotsByKey;
    expect(snaps["ws1:db1"].rows.map((r) => r.pageId)).toEqual(["p1", "p3"]);
    expect(snaps["ws1:db2"].rows.map((r) => r.pageId)).toEqual(["p4"]);
  });

  it("해당 pageId 가 없는 스냅샷은 그대로 둔다(참조 유지)", async () => {
    const store = useDatabaseRowIndexStore.getState();
    await store.upsertRows("ws1:db1", "db1", [row("p1")], { reset: true });
    const before = useDatabaseRowIndexStore.getState().snapshotsByKey["ws1:db1"];

    await useDatabaseRowIndexStore.getState().removePagesFromAllIndexes(["pX"]);

    const after = useDatabaseRowIndexStore.getState().snapshotsByKey["ws1:db1"];
    expect(after).toBe(before);
  });

  it("빈 입력은 no-op", async () => {
    const store = useDatabaseRowIndexStore.getState();
    await store.upsertRows("ws1:db1", "db1", [row("p1")], { reset: true });
    await useDatabaseRowIndexStore.getState().removePagesFromAllIndexes([]);
    expect(
      useDatabaseRowIndexStore.getState().snapshotsByKey["ws1:db1"].rows,
    ).toHaveLength(1);
  });
});
