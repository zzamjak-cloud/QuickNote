import { beforeEach, describe, expect, it } from "vitest";
import { reconcileWorkspacePagesFullSnapshot } from "../storeApply";
import { usePageStore } from "../../../store/pageStore";
import { useDatabaseRowIndexStore } from "../../../store/databaseRowIndexStore";
import type { Page } from "../../../types/page";
import type { DatabaseRowIndexEntry } from "../../../lib/database/databaseRowIndexCache";

// 좀비 페이지 prune 이 row-index 스냅샷도 함께 정리하는지 고정.
// 누락 시: 하드 삭제/재생성된 행이 IndexedDB 캐시에 남아 새로고침마다
// fallback 유령으로 렌더되어 실제 행과 2벌(중복)로 보인다.

const WS = "ws-1";

function page(id: string): Page {
  return {
    id,
    workspaceId: WS,
    title: id,
    icon: null,
    doc: { type: "doc", content: [] },
    parentId: null,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    databaseId: "db-1",
  };
}

function indexRow(pageId: string): DatabaseRowIndexEntry {
  return {
    pageId,
    workspaceId: WS,
    databaseId: "db-1",
    title: pageId,
    icon: null,
    order: 0,
    updatedAt: 1,
  };
}

describe("reconcileWorkspacePagesFullSnapshot — row-index 연동", () => {
  beforeEach(() => {
    usePageStore.setState({
      pages: {},
      activePageId: null,
      cacheWorkspaceId: WS,
    });
    useDatabaseRowIndexStore.setState({
      snapshotsByKey: {},
      hydratedByKey: {},
      loadingByKey: {},
    });
  });

  it("prune 된 좀비 페이지를 row-index 스냅샷에서도 제거한다", async () => {
    usePageStore.setState((s) => ({
      pages: { ...s.pages, live: page("live"), ghost: page("ghost") },
    }));
    await useDatabaseRowIndexStore
      .getState()
      .upsertRows("ws-1:db-1", "db-1", [indexRow("live"), indexRow("ghost")], {
        reset: true,
      });

    const { removedPageIds } = reconcileWorkspacePagesFullSnapshot({
      workspaceId: WS,
      remotePageIds: new Set(["live"]),
      pendingUpsertPageIds: new Set(),
    });

    expect(removedPageIds).toEqual(["ghost"]);
    expect(usePageStore.getState().pages["ghost"]).toBeUndefined();
    const rows =
      useDatabaseRowIndexStore.getState().snapshotsByKey["ws-1:db-1"]?.rows ??
      [];
    expect(rows.map((r) => r.pageId)).toEqual(["live"]);
  });

  it("prune 대상이 없으면 row-index 스냅샷을 건드리지 않는다", async () => {
    usePageStore.setState((s) => ({
      pages: { ...s.pages, live: page("live") },
    }));
    await useDatabaseRowIndexStore
      .getState()
      .upsertRows("ws-1:db-1", "db-1", [indexRow("live")], { reset: true });
    const before =
      useDatabaseRowIndexStore.getState().snapshotsByKey["ws-1:db-1"];

    reconcileWorkspacePagesFullSnapshot({
      workspaceId: WS,
      remotePageIds: new Set(["live"]),
      pendingUpsertPageIds: new Set(),
    });

    expect(
      useDatabaseRowIndexStore.getState().snapshotsByKey["ws-1:db-1"],
    ).toBe(before);
  });
});
