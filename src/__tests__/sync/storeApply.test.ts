import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  applyRemotePageToStore,
  applyRemotePageMetasToStore,
  applyRemoteDatabaseToStore,
  applyRemotePagesToStore,
  applyRemoteDatabasesToStore,
  reconcileLCSchedulerRemoteSnapshot,
} from "../../lib/sync/storeApply";
import { usePageStore } from "../../store/pageStore";
import { usePageContentLoadStore } from "../../store/pageContentLoadStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useHistoryStore } from "../../store/historyStore";
import type { GqlDatabase, GqlPage, GqlPageMeta } from "../../lib/sync/graphql/operations";
import { makeLCSchedulerDatabaseId } from "../../lib/scheduler/database";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../lib/scheduler/scope";
import { markLocallyDeletedEntity } from "../../lib/sync/localDeleteGuards";
import { registerPageCollab, unregisterPageCollab } from "../../lib/collab/pageCollabRegistry";

const GUARDS_KEY = "quicknote.sync.localDeleteGuards.v1";

function spyLocalStorageGetItem(): {
  getItem: ReturnType<typeof vi.fn>;
  restore: () => void;
} {
  const original = localStorage.getItem.bind(localStorage);
  const getItem = vi.fn((key: string) => original(key));
  Object.defineProperty(localStorage, "getItem", {
    value: getItem,
    configurable: true,
  });
  return {
    getItem,
    restore: () => {
      Object.defineProperty(localStorage, "getItem", {
        value: original,
        configurable: true,
      });
    },
  };
}

function gqlPage(ws: string, id = "pg-1"): GqlPage {
  const now = new Date().toISOString();
  return {
    id,
    workspaceId: ws,
    createdByMemberId: "mem",
    title: "T",
    order: "0",
    doc: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
    createdAt: now,
    updatedAt: now,
  };
}

function gqlPageMeta(ws: string, id = "pg-1", updatedAt = new Date().toISOString()): GqlPageMeta {
  return {
    id,
    workspaceId: ws,
    createdByMemberId: "mem",
    title: "T",
    order: "0",
    createdAt: updatedAt,
    updatedAt,
  };
}

function gqlDb(ws: string, id = "db-1"): GqlDatabase {
  const now = new Date().toISOString();
  return {
    id,
    workspaceId: ws,
    createdByMemberId: "mem",
    title: "D",
    columns: "[]",
    createdAt: now,
    updatedAt: now,
  };
}

describe("storeApply 워크스페이스 가드", () => {
  beforeEach(() => {
    localStorage.clear();
    useWorkspaceStore.setState({ currentWorkspaceId: null, workspaces: [] });
    usePageStore.setState({
      pages: {},
      activePageId: null,
      cacheWorkspaceId: null,
    });
    usePageContentLoadStore.getState().clear();
    useDatabaseStore.setState({ databases: {}, cacheWorkspaceId: null });
    useHistoryStore.setState({
      pageEventsByPageId: {},
      dbEventsByDatabaseId: {},
      deletedRowTombstonesByDbId: {},
      cacheWorkspaceId: null,
    });
  });

  it("현재 워크스페이스와 일치하면 페이지·DB 가 반영된다", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-a" });
    applyRemotePageToStore(gqlPage("ws-a"));
    applyRemoteDatabaseToStore(gqlDb("ws-a"));
    expect(usePageStore.getState().pages["pg-1"]).toBeDefined();
    expect(useDatabaseStore.getState().databases["db-1"]).toBeDefined();
  });

  it("페이지 메타는 본문 placeholder로 저장하고 같은 updatedAt의 full page가 오면 교체한다", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-a" });
    const updatedAt = "2026-01-01T00:00:00.000Z";
    applyRemotePageMetasToStore([gqlPageMeta("ws-a", "pg-1", updatedAt)]);

    expect(usePageContentLoadStore.getState().metaOnlyByPageId["pg-1"]).toBe(true);
    expect(usePageStore.getState().pages["pg-1"]?.contentLoaded).toBe(false);
    expect(usePageStore.getState().pages["pg-1"]?.doc.content).toHaveLength(1);

    applyRemotePageToStore({
      ...gqlPage("ws-a", "pg-1"),
      updatedAt,
      doc: JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "loaded" }],
          },
        ],
      }),
    });

    expect(usePageContentLoadStore.getState().metaOnlyByPageId["pg-1"]).toBeUndefined();
    expect(usePageStore.getState().pages["pg-1"]?.contentLoaded).toBe(true);
    expect(JSON.stringify(usePageStore.getState().pages["pg-1"]?.doc)).toContain("loaded");
  });

  it("stale metaOnly 플래그가 남아도 full-cache 페이지를 다시 meta-only 로 만들지 않는다", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-a" });
    const updatedAt = "2026-01-02T00:00:00.000Z";
    applyRemotePageToStore({
      ...gqlPage("ws-a", "pg-1"),
      updatedAt,
      doc: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "cached" }] }],
      }),
    });
    usePageContentLoadStore.getState().markMetaOnly(["pg-1"]);

    applyRemotePageMetasToStore([gqlPageMeta("ws-a", "pg-1", updatedAt)]);

    expect(usePageStore.getState().pages["pg-1"]?.contentLoaded).toBe(true);
    expect(usePageContentLoadStore.getState().metaOnlyByPageId["pg-1"]).toBeUndefined();
  });

  it("협업 활성 페이지의 로컬 placeholder 는 서버 실제 본문을 막지 않는다", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-a" });
    applyRemotePageToStore({
      ...gqlPage("ws-a", "pg-1"),
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    registerPageCollab("pg-1");

    try {
      applyRemotePageToStore({
        ...gqlPage("ws-a", "pg-1"),
        updatedAt: "2026-01-01T00:01:00.000Z",
        doc: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "server body" }],
            },
          ],
        }),
      });

      expect(JSON.stringify(usePageStore.getState().pages["pg-1"]?.doc)).toContain("server body");
    } finally {
      unregisterPageCollab("pg-1");
    }
  });

  it("현재 워크스페이스와 다르면 적용하지 않는다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-a" });
    applyRemotePageToStore(gqlPage("ws-b"));
    applyRemoteDatabaseToStore(gqlDb("ws-b"));
    expect(usePageStore.getState().pages).toEqual({});
    expect(useDatabaseStore.getState().databases).toEqual({});
    expect(warn.mock.calls.length).toBeGreaterThanOrEqual(2);
    warn.mockRestore();
  });

  it("workspaceId 미선택 시에는 적용 허용(부트 초기 호환)", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: null });
    applyRemotePageToStore(gqlPage("ws-any"));
    expect(usePageStore.getState().pages["pg-1"]).toBeDefined();
  });

  it("coverImage 가 원격에서 로컬 페이지에 반영된다", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-a" });
    const p = gqlPage("ws-a");
    p.coverImage = "data:image/png;base64,QUJD";
    applyRemotePageToStore(p);
    expect(usePageStore.getState().pages["pg-1"]?.coverImage).toBe(
      "data:image/png;base64,QUJD",
    );
  });

  it("원격 DB 적용 시 로컬 rowPageOrder 가 비어 있으면 databaseId 행 페이지로 복구한다", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-a" });
    const row = gqlPage("ws-a", "row-1");
    row.databaseId = "db-1";
    applyRemotePageToStore(row);
    applyRemoteDatabaseToStore(gqlDb("ws-a", "db-1"));
    expect(useDatabaseStore.getState().databases["db-1"]?.rowPageOrder).toEqual([
      "row-1",
    ]);
  });

  it("페이지 메타 적용 시 로컬 DB rowPageOrder 가 비어 있으면 databaseId 행 페이지로 복구한다", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-a" });
    applyRemoteDatabaseToStore(gqlDb("ws-a", "db-1"));
    const row = gqlPageMeta("ws-a", "row-1");
    row.databaseId = "db-1";

    applyRemotePageMetasToStore([row]);

    expect(useDatabaseStore.getState().databases["db-1"]?.rowPageOrder).toEqual([
      "row-1",
    ]);
  });

  it("DB batch 적용이 최신/동일 DB를 건너뛰어도 rowPageOrder 는 복구한다", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-a" });
    const iso = "2026-01-01T00:00:00.000Z";
    const ms = Date.parse(iso);
    const row = gqlPage("ws-a", "row-1");
    row.databaseId = "db-1";
    applyRemotePageToStore(row);
    useDatabaseStore.setState({
      databases: {
        "db-1": {
          meta: { id: "db-1", workspaceId: "ws-a", title: "D", createdAt: ms, updatedAt: ms },
          columns: [],
          rowPageOrder: [],
        },
      },
      cacheWorkspaceId: "ws-a",
    });
    const remote = gqlDb("ws-a", "db-1");
    remote.createdAt = iso;
    remote.updatedAt = iso;

    applyRemoteDatabasesToStore([remote]);

    expect(useDatabaseStore.getState().databases["db-1"]?.rowPageOrder).toEqual([
      "row-1",
    ]);
  });

  it("원격 DB 최초 적용 시 로컬 히스토리가 비어 있으면 db.create 베이스라인을 남긴다", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-a" });
    applyRemoteDatabaseToStore(gqlDb("ws-a", "db-seed"));
    const events = useHistoryStore.getState().dbEventsByDatabaseId["db-seed"] ?? [];
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]?.kind).toBe("db.create");
  });

  it("로컬에서 삭제한 DB는 더 오래된 원격 active 스냅샷으로 되살리지 않는다", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-a" });
    const deletedAtMs = Date.now();
    markLocallyDeletedEntity("database", "db-deleted", "ws-a", deletedAtMs);
    const remote = gqlDb("ws-a", "db-deleted");
    remote.updatedAt = new Date(deletedAtMs - 1_000).toISOString();
    applyRemoteDatabaseToStore(remote);
    expect(useDatabaseStore.getState().databases["db-deleted"]).toBeUndefined();
  });

  it("로컬에서 삭제한 페이지는 더 오래된 원격 active 스냅샷으로 되살리지 않는다", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-a" });
    const deletedAtMs = Date.now();
    markLocallyDeletedEntity("page", "pg-deleted", "ws-a", deletedAtMs);
    const remote = gqlPage("ws-a", "pg-deleted");
    remote.updatedAt = new Date(deletedAtMs - 1_000).toISOString();
    applyRemotePageToStore(remote);
    expect(usePageStore.getState().pages["pg-deleted"]).toBeUndefined();
  });

  it("페이지 batch 적용은 로컬 삭제 guard storage 를 한 번만 읽는다", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-a" });
    const deletedAtMs = Date.now();
    localStorage.setItem(GUARDS_KEY, JSON.stringify({
      "page:ws-a:pg-0": { deletedAtMs },
    }));
    const pages = Array.from({ length: 5 }, (_, index) => {
      const page = gqlPage("ws-a", `pg-${index}`);
      page.updatedAt = new Date(deletedAtMs - 1_000).toISOString();
      return page;
    });
    const { getItem, restore } = spyLocalStorageGetItem();

    applyRemotePagesToStore(pages);

    expect(usePageStore.getState().pages["pg-0"]).toBeUndefined();
    expect(usePageStore.getState().pages["pg-1"]).toBeDefined();
    expect(getItem.mock.calls.filter(([key]) => key === GUARDS_KEY)).toHaveLength(1);
    restore();
  });

  it("DB batch 적용은 로컬 삭제 guard storage 를 한 번만 읽는다", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-a" });
    const deletedAtMs = Date.now();
    localStorage.setItem(GUARDS_KEY, JSON.stringify({
      "database:ws-a:db-0": { deletedAtMs },
    }));
    const dbs = Array.from({ length: 5 }, (_, index) => {
      const db = gqlDb("ws-a", `db-${index}`);
      db.updatedAt = new Date(deletedAtMs - 1_000).toISOString();
      return db;
    });
    const { getItem, restore } = spyLocalStorageGetItem();

    applyRemoteDatabasesToStore(dbs);

    expect(useDatabaseStore.getState().databases["db-0"]).toBeUndefined();
    expect(useDatabaseStore.getState().databases["db-1"]).toBeDefined();
    expect(getItem.mock.calls.filter(([key]) => key === GUARDS_KEY)).toHaveLength(1);
    restore();
  });

  it("원격 workspaceId 가 비면 적용하지 않는다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-a" });
    const bad = gqlPage("", "bad");
    applyRemotePageToStore(bad);
    expect(usePageStore.getState().pages).toEqual({});
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("LWW 동률이어도 order 가 다르면 원격 메타를 반영한다", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-a" });
    const iso = "2026-05-06T12:00:00.000Z";
    const ms = Date.parse(iso);
    usePageStore.setState({
      pages: {
        "pg-1": {
          id: "pg-1",
          title: "Local",
          icon: null,
          doc: { type: "doc", content: [{ type: "paragraph" }] },
          parentId: null,
          order: 0,
          createdAt: ms,
          updatedAt: ms,
        },
      },
      activePageId: null,
      cacheWorkspaceId: "ws-a",
    });
    const remote = gqlPage("ws-a", "pg-1");
    remote.updatedAt = iso;
    remote.order = "3";
    remote.title = "RemoteTitle";
    applyRemotePageToStore(remote);
    expect(usePageStore.getState().pages["pg-1"]?.order).toBe(3);
    expect(usePageStore.getState().pages["pg-1"]?.title).toBe("RemoteTitle");
  });

  it("LWW 동률이고 order·parentId 가 같으면 덮어쓰지 않는다", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-a" });
    const iso = "2026-05-06T12:00:00.000Z";
    const ms = Date.parse(iso);
    usePageStore.setState({
      pages: {
        "pg-1": {
          id: "pg-1",
          title: "KeepMe",
          icon: null,
          doc: { type: "doc", content: [{ type: "paragraph" }] },
          parentId: null,
          order: 0,
          createdAt: ms,
          updatedAt: ms,
        },
      },
      activePageId: null,
      cacheWorkspaceId: "ws-a",
    });
    const remote = gqlPage("ws-a", "pg-1");
    remote.updatedAt = iso;
    remote.order = "0";
    remote.title = "OtherTitle";
    applyRemotePageToStore(remote);
    expect(usePageStore.getState().pages["pg-1"]?.title).toBe("KeepMe");
  });

  it("증분 스냅샷에 없는(=변경되지 않은) 로컬 LC 스케줄러 행은 prune 하지 않는다", () => {
    // scoped/부분 로딩 방향: delta 에 없다고 살아있는 행을 지우면 안 된다.
    useWorkspaceStore.setState({ currentWorkspaceId: "personal-ws" });
    const dbId = makeLCSchedulerDatabaseId(LC_SCHEDULER_WORKSPACE_ID);
    const old = Date.now() - 300_000;
    usePageStore.setState({
      pages: {
        "unchanged-row": {
          id: "unchanged-row",
          title: "변경 안 된 일정",
          icon: null,
          doc: { type: "doc", content: [{ type: "paragraph" }] },
          parentId: null,
          order: 0,
          databaseId: dbId,
          dbCells: {},
          createdAt: old,
          updatedAt: old,
        },
      },
      activePageId: "unchanged-row",
      cacheWorkspaceId: "personal-ws",
    });
    useDatabaseStore.setState({
      databases: {
        [dbId]: {
          meta: { id: dbId, title: "LC스케줄러", createdAt: old, updatedAt: old },
          columns: [],
          rowPageOrder: ["unchanged-row"],
        },
      },
      cacheWorkspaceId: "personal-ws",
    });

    const result = reconcileLCSchedulerRemoteSnapshot({
      pages: [],
      databases: [],
    });

    expect(result.prunedPageIds).toEqual([]);
    expect(usePageStore.getState().pages["unchanged-row"]).toBeDefined();
    expect(useDatabaseStore.getState().databases[dbId]?.rowPageOrder).toEqual(["unchanged-row"]);
  });

  it("증분 스냅샷의 deletedAt 행은 로컬에서 제거한다(삭제 전파)", () => {
    const dbId = makeLCSchedulerDatabaseId(LC_SCHEDULER_WORKSPACE_ID);
    const old = Date.now() - 300_000;
    usePageStore.setState({
      pages: {
        "deleted-row": {
          id: "deleted-row",
          title: "삭제된 일정",
          icon: null,
          doc: { type: "doc", content: [{ type: "paragraph" }] },
          parentId: null,
          order: 0,
          databaseId: dbId,
          dbCells: {},
          createdAt: old,
          updatedAt: old,
        },
      },
      activePageId: null,
      cacheWorkspaceId: "personal-ws",
    });

    const remote = gqlPage(LC_SCHEDULER_WORKSPACE_ID, "deleted-row");
    remote.databaseId = dbId;
    remote.deletedAt = new Date().toISOString();
    reconcileLCSchedulerRemoteSnapshot({ pages: [remote], databases: [] });

    expect(usePageStore.getState().pages["deleted-row"]).toBeUndefined();
  });

});
