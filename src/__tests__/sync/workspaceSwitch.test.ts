import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyWorkspaceSwitch, workspaceCacheNeedsPrepaintClear } from "../../lib/sync/workspaceSwitch";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useSettingsStore } from "../../store/settingsStore";

// runtime.getSyncEngine 을 mock 하여 outbox 상태(peekPending)를 제어한다.
vi.mock("../../lib/sync/runtime", () => {
  let pending = 0;
  let snapshot: Array<{ workspaceId?: string | null }> | null = null;
  return {
    __setPending: (n: number) => {
      pending = n;
      snapshot = null;
    },
    __setSnapshot: (items: Array<{ workspaceId?: string | null }> | null) => {
      snapshot = items;
    },
    getSyncEngine: async () => ({
      peekPending: async () => pending,
      debugSnapshot: async () =>
        snapshot ?? Array.from({ length: pending }, () => ({ workspaceId: "ws-pending" })),
    }),
  };
});

import * as runtime from "../../lib/sync/runtime";
const runtimeMock = runtime as unknown as {
  __setPending: (n: number) => void;
  __setSnapshot: (items: Array<{ workspaceId?: string | null }> | null) => void;
};
const setPending = runtimeMock.__setPending;
const setSnapshot = runtimeMock.__setSnapshot;

beforeEach(() => {
  localStorage.clear();
  usePageStore.setState({ pages: {}, activePageId: null, cacheWorkspaceId: null });
  useDatabaseStore.setState({ databases: {}, cacheWorkspaceId: null });
  useSettingsStore.setState({ tabs: [{ pageId: null }], activeTabIndex: 0 });
  setPending(0);
  setSnapshot(null);
});

describe("applyWorkspaceSwitch", () => {
  it("초기 부트스트랩(prev=null)에서 현재 워크스페이스 캐시임이 확인되면 유지한다", async () => {
    usePageStore.getState().createPage("a");
    usePageStore.setState({ cacheWorkspaceId: "ws-1" });
    const result = await applyWorkspaceSwitch(null, "ws-1");
    expect(result.cleared).toBe(false);
    expect(result.reason).toBe("initial-bootstrap");
    expect(Object.keys(usePageStore.getState().pages).length).toBe(1);
  });

  it("초기 부트스트랩(prev=null)에서 워크스페이스를 알 수 없는 구버전 캐시는 클리어한다", async () => {
    usePageStore.getState().createPage("a");
    usePageStore.setState({ cacheWorkspaceId: null });
    useSettingsStore.setState({
      tabs: [{ pageId: Object.keys(usePageStore.getState().pages)[0] ?? null }],
      activeTabIndex: 0,
    });
    const result = await applyWorkspaceSwitch(null, "ws-1");
    expect(result.cleared).toBe(true);
    expect(result.reason).toBe("initial-cache-mismatch");
    expect(usePageStore.getState().pages).toEqual({});
    expect(usePageStore.getState().cacheWorkspaceId).toBe("ws-1");
    expect(useSettingsStore.getState().tabs).toEqual([{ pageId: null }]);
  });

  it("초기 부트스트랩(prev=null)에서 다른 워크스페이스 캐시는 클리어한다", async () => {
    usePageStore.getState().createPage("a");
    usePageStore.setState({ cacheWorkspaceId: "ws-old" });
    const result = await applyWorkspaceSwitch(null, "ws-1");
    expect(result.cleared).toBe(true);
    expect(result.reason).toBe("initial-cache-mismatch");
    expect(usePageStore.getState().pages).toEqual({});
  });

  it("초기 부트스트랩(prev=null)에서 일부 store 캐시 소속이 불명확하면 클리어한다", async () => {
    usePageStore.getState().createPage("a");
    usePageStore.setState({ cacheWorkspaceId: null });
    useDatabaseStore.setState({
      cacheWorkspaceId: "ws-1",
      databases: {
        "db-1": {
          meta: { id: "db-1", title: "x", createdAt: 0, updatedAt: 0 },
          columns: [],
          rowPageOrder: [],
        },
      },
    });
    const result = await applyWorkspaceSwitch(null, "ws-1");
    expect(result.cleared).toBe(true);
    expect(result.reason).toBe("initial-cache-mismatch");
    expect(usePageStore.getState().pages).toEqual({});
    expect(useDatabaseStore.getState().databases).toEqual({});
  });

  it("동일 워크스페이스 ID 일 때는 캐시를 유지한다", async () => {
    usePageStore.getState().createPage("a");
    usePageStore.setState({ cacheWorkspaceId: "ws-1" });
    const result = await applyWorkspaceSwitch("ws-1", "ws-1");
    expect(result.cleared).toBe(false);
    expect(result.reason).toBe("same-workspace");
    expect(Object.keys(usePageStore.getState().pages).length).toBe(1);
  });

  it("outbox pending 이 0 이면 다른 워크스페이스로 전환 시 클리어한다", async () => {
    usePageStore.getState().createPage("a");
    usePageStore.setState({ cacheWorkspaceId: "ws-1" });
    useDatabaseStore.setState({
      cacheWorkspaceId: "ws-1",
      databases: {
        "db-1": {
          meta: { id: "db-1", title: "x", createdAt: 0, updatedAt: 0 },
          columns: [],
          rowPageOrder: [],
        },
      },
    });
    setPending(0);
    const result = await applyWorkspaceSwitch("ws-1", "ws-2");
    expect(result.cleared).toBe(true);
    expect(usePageStore.getState().pages).toEqual({});
    expect(useDatabaseStore.getState().databases).toEqual({});
  });

  it("outbox 에 pending 이 있으면 클리어를 보류한다 (데이터 손실 방지)", async () => {
    usePageStore.getState().createPage("a");
    usePageStore.setState({ cacheWorkspaceId: "ws-1" });
    setPending(2);
    const result = await applyWorkspaceSwitch("ws-1", "ws-2");
    expect(result.cleared).toBe(false);
    expect(result.reason).toBe("pending-outbox");
    expect(Object.keys(usePageStore.getState().pages).length).toBe(1);
  });

  it("LC 스케줄러 공용 캐시만 있으면 현재 워크스페이스 prepaint 차단 대상으로 보지 않는다", () => {
    usePageStore.setState({
      cacheWorkspaceId: "lc-scheduler-global",
      pages: {
        "row-1": {
          id: "row-1",
          title: "일정",
          doc: { type: "doc", content: [{ type: "paragraph" }] },
          parentId: null,
          order: 1,
          databaseId: "lc-scheduler-db:lc-scheduler-global",
          createdAt: 0,
          updatedAt: 0,
        },
      },
    });
    useDatabaseStore.setState({
      cacheWorkspaceId: "lc-scheduler-global",
      databases: {
        "lc-scheduler-db:lc-scheduler-global": {
          meta: {
            id: "lc-scheduler-db:lc-scheduler-global",
            title: "LC스케줄러",
            createdAt: 0,
            updatedAt: 0,
          },
          columns: [],
          rowPageOrder: ["row-1"],
        },
      },
    });

    expect(workspaceCacheNeedsPrepaintClear("ws-1")).toBe(false);
  });

  it("LC 스케줄러 공용 outbox 만 있으면 캐시 클리어 보류 사유에서 제외한다", async () => {
    usePageStore.getState().createPage("a");
    usePageStore.setState({ cacheWorkspaceId: "ws-1" });
    setSnapshot([{ workspaceId: "lc-scheduler-global" }]);

    const result = await applyWorkspaceSwitch("ws-1", "ws-2");
    expect(result.cleared).toBe(true);
    expect(result.pending).toBe(0);
  });
});
