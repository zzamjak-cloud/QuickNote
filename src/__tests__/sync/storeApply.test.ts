import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  applyRemotePageToStore,
  applyRemoteDatabaseToStore,
} from "../../lib/sync/storeApply";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
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

  it("원격 workspaceId 가 비면 적용하지 않는다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-a" });
    const bad = gqlPage("", "bad");
    applyRemotePageToStore(bad);
    expect(usePageStore.getState().pages).toEqual({});
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
