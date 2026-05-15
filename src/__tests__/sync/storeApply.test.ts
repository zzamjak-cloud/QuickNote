import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  applyRemotePageToStore,
  applyRemoteDatabaseToStore,
} from "../../lib/sync/storeApply";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useHistoryStore } from "../../store/historyStore";
import type { GqlDatabase, GqlPage } from "../../lib/sync/graphql/operations";

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

  it("원격 DB 최초 적용 시 로컬 히스토리가 비어 있으면 db.create 베이스라인을 남긴다", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-a" });
    applyRemoteDatabaseToStore(gqlDb("ws-a", "db-seed"));
    const events = useHistoryStore.getState().dbEventsByDatabaseId["db-seed"] ?? [];
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]?.kind).toBe("db.create");
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
});
