import { beforeEach, describe, expect, it } from "vitest";
import { reconcileWorkspaceDatabasesFullSnapshot } from "../storeApply";
import { useDatabaseStore } from "../../../store/databaseStore";
import { usePageStore } from "../../../store/pageStore";
import { LC_SCHEDULER_DATABASE_ID } from "../../scheduler/database";
import type { DatabaseBundle } from "../../../types/database";

const WS = "ws-1";

function bundle(id: string, workspaceId: string | undefined): DatabaseBundle {
  return {
    meta: { id, workspaceId, title: id, createdAt: 1, updatedAt: 1 },
    columns: [{ id: "title", name: "Name", type: "title" }],
    presets: [],
    rowPageOrder: [],
  };
}

describe("reconcileWorkspaceDatabasesFullSnapshot", () => {
  beforeEach(() => {
    useDatabaseStore.setState({
      databases: {},
      cacheWorkspaceId: WS,
      migrationQuarantine: [],
      dbTemplates: {},
    });
    usePageStore.setState({ pages: {}, activePageId: null });
  });

  it("서버 전체 목록에 없는 같은 워크스페이스 좀비 DB 를 제거한다", () => {
    useDatabaseStore.setState({
      databases: {
        "db-live": bundle("db-live", WS),
        "db-ghost": bundle("db-ghost", WS),
        "db-ghost-no-ws": bundle("db-ghost-no-ws", undefined),
      },
      cacheWorkspaceId: WS,
      migrationQuarantine: [],
      dbTemplates: { "db-ghost": [{ id: "t", title: "T", cells: {} }] },
    });

    const result = reconcileWorkspaceDatabasesFullSnapshot({
      workspaceId: WS,
      remoteDatabaseIds: new Set(["db-live"]),
      pendingUpsertDatabaseIds: new Set(),
    });

    const dbs = useDatabaseStore.getState().databases;
    expect(Object.keys(dbs).sort()).toEqual(["db-live"]);
    expect(useDatabaseStore.getState().dbTemplates["db-ghost"]).toBeUndefined();
    expect(result.removedDatabaseIds.sort()).toEqual(["db-ghost", "db-ghost-no-ws"]);
  });

  it("outbox 업로드 대기·보호 DB·다른 워크스페이스 DB 는 보존한다", () => {
    useDatabaseStore.setState({
      databases: {
        "db-pending": bundle("db-pending", WS),
        [LC_SCHEDULER_DATABASE_ID]: bundle(LC_SCHEDULER_DATABASE_ID, WS),
        "db-other-ws": bundle("db-other-ws", "ws-2"),
      },
      cacheWorkspaceId: WS,
      migrationQuarantine: [],
      dbTemplates: {},
    });

    const result = reconcileWorkspaceDatabasesFullSnapshot({
      workspaceId: WS,
      remoteDatabaseIds: new Set(),
      pendingUpsertDatabaseIds: new Set(["db-pending"]),
    });

    const dbs = useDatabaseStore.getState().databases;
    expect(Object.keys(dbs).sort()).toEqual(
      ["db-other-ws", "db-pending", LC_SCHEDULER_DATABASE_ID].sort(),
    );
    expect(result.removedDatabaseIds).toEqual([]);
  });

  it("좀비 DB 를 제거해도 행 페이지는 보존한다(멘션 해석 근거 — 회귀 가드)", () => {
    // 행 페이지 meta 는 멘션/페이지링크가 아이콘·이동을 해석하는 근거이고 listPageMetas 로
    // 로드된다. 여기서 지우면 멀쩡한 멘션이 깨지므로 DB 번들만 제거하고 페이지는 건드리지 않는다.
    useDatabaseStore.setState({
      databases: { "db-ghost": bundle("db-ghost", WS) },
      cacheWorkspaceId: WS,
      migrationQuarantine: [],
      dbTemplates: {},
    });
    usePageStore.setState({
      pages: {
        "row-1": { id: "row-1", title: "r1", databaseId: "db-ghost", workspaceId: WS } as never,
        "page-keep": { id: "page-keep", title: "keep", workspaceId: WS } as never,
      },
      activePageId: "row-1",
    });

    const result = reconcileWorkspaceDatabasesFullSnapshot({
      workspaceId: WS,
      remoteDatabaseIds: new Set(),
      pendingUpsertDatabaseIds: new Set(),
    });

    expect(useDatabaseStore.getState().databases["db-ghost"]).toBeUndefined();
    // 페이지는 그대로 보존되어야 한다.
    expect(Object.keys(usePageStore.getState().pages).sort()).toEqual(["page-keep", "row-1"]);
    expect(usePageStore.getState().activePageId).toBe("row-1");
    expect(result.removedDatabaseIds).toEqual(["db-ghost"]);
  });

  it("cacheWorkspaceId 가 대상 워크스페이스와 다르면 아무것도 지우지 않는다", () => {
    useDatabaseStore.setState({
      databases: { "db-ghost": bundle("db-ghost", "ws-other") },
      cacheWorkspaceId: "ws-other",
      migrationQuarantine: [],
      dbTemplates: {},
    });

    const result = reconcileWorkspaceDatabasesFullSnapshot({
      workspaceId: WS,
      remoteDatabaseIds: new Set(),
      pendingUpsertDatabaseIds: new Set(),
    });

    expect(Object.keys(useDatabaseStore.getState().databases)).toEqual(["db-ghost"]);
    expect(result.removedDatabaseIds).toEqual([]);
  });
});
