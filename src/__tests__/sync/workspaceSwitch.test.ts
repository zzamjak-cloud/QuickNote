import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyWorkspaceSwitch } from "../../lib/sync/workspaceSwitch";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";

// runtime.getSyncEngine 을 mock 하여 outbox 상태(peekPending)를 제어한다.
vi.mock("../../lib/sync/runtime", () => {
  let pending = 0;
  return {
    __setPending: (n: number) => (pending = n),
    getSyncEngine: async () => ({
      peekPending: async () => pending,
    }),
  };
});

import * as runtime from "../../lib/sync/runtime";
const setPending = (runtime as unknown as { __setPending: (n: number) => void })
  .__setPending;

beforeEach(() => {
  localStorage.clear();
  usePageStore.setState({ pages: {}, activePageId: null });
  useDatabaseStore.setState({ databases: {} });
  setPending(0);
});

describe("applyWorkspaceSwitch", () => {
  it("초기 부트스트랩(prev=null)에서는 persist 첫 페인트를 위해 캐시를 유지한다", async () => {
    usePageStore.getState().createPage("a");
    const result = await applyWorkspaceSwitch(null, "ws-1");
    expect(result.cleared).toBe(false);
    expect(result.reason).toBe("initial-bootstrap");
    expect(Object.keys(usePageStore.getState().pages).length).toBe(1);
  });

  it("동일 워크스페이스 ID 일 때는 캐시를 유지한다", async () => {
    usePageStore.getState().createPage("a");
    const result = await applyWorkspaceSwitch("ws-1", "ws-1");
    expect(result.cleared).toBe(false);
    expect(result.reason).toBe("same-workspace");
    expect(Object.keys(usePageStore.getState().pages).length).toBe(1);
  });

  it("outbox pending 이 0 이면 다른 워크스페이스로 전환 시 클리어한다", async () => {
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
    setPending(0);
    const result = await applyWorkspaceSwitch("ws-1", "ws-2");
    expect(result.cleared).toBe(true);
    expect(usePageStore.getState().pages).toEqual({});
    expect(useDatabaseStore.getState().databases).toEqual({});
  });

  it("outbox 에 pending 이 있으면 클리어를 보류한다 (데이터 손실 방지)", async () => {
    usePageStore.getState().createPage("a");
    setPending(2);
    const result = await applyWorkspaceSwitch("ws-1", "ws-2");
    expect(result.cleared).toBe(false);
    expect(result.reason).toBe("pending-outbox");
    expect(Object.keys(usePageStore.getState().pages).length).toBe(1);
  });
});
