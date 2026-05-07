import { describe, it, expect, beforeEach } from "vitest";
import { applyWorkspaceSwitch } from "../../lib/sync/workspaceSwitch";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";

beforeEach(() => {
  localStorage.clear();
  usePageStore.setState({ pages: {}, activePageId: null });
  useDatabaseStore.setState({ databases: {} });
});

describe("applyWorkspaceSwitch", () => {
  it("초기 마운트(prev=null)에서는 캐시를 유지한다", () => {
    usePageStore.getState().createPage("a");
    const before = Object.keys(usePageStore.getState().pages).length;
    expect(before).toBe(1);

    applyWorkspaceSwitch(null, "ws-1");

    expect(Object.keys(usePageStore.getState().pages).length).toBe(1);
  });

  it("동일 워크스페이스 ID 일 때는 캐시를 유지한다", () => {
    usePageStore.getState().createPage("a");

    applyWorkspaceSwitch("ws-1", "ws-1");

    expect(Object.keys(usePageStore.getState().pages).length).toBe(1);
  });

  it("다른 워크스페이스로 전환 시 pages 와 databases 를 비운다", () => {
    usePageStore.getState().createPage("a");
    useDatabaseStore.setState({
      databases: {
        "db-1": {
          meta: { id: "db-1", title: "x", createdAt: 0, updatedAt: 0 },
          columns: [],
          rowPageOrder: [],
        },
      },
    });

    applyWorkspaceSwitch("ws-1", "ws-2");

    expect(usePageStore.getState().pages).toEqual({});
    expect(usePageStore.getState().activePageId).toBeNull();
    expect(useDatabaseStore.getState().databases).toEqual({});
  });

  it("워크스페이스 컨텍스트 종료(next=null)에서도 비운다", () => {
    usePageStore.getState().createPage("a");

    applyWorkspaceSwitch("ws-1", null);

    expect(usePageStore.getState().pages).toEqual({});
  });
});
