import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore, type WorkspaceSummary } from "../workspaceStore";

function ws(partial: Partial<WorkspaceSummary> & { workspaceId: string; name: string }): WorkspaceSummary {
  return {
    workspaceId: partial.workspaceId,
    name: partial.name,
    type: partial.type ?? "shared",
    ownerMemberId: partial.ownerMemberId ?? "owner-1",
    myEffectiveLevel: partial.myEffectiveLevel ?? "edit",
    createdAt: partial.createdAt,
  };
}

describe("workspaceStore", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ currentWorkspaceId: null, workspaces: [] });
  });

  it("현재 활성 워크스페이스 ID를 저장하고 변경한다", () => {
    useWorkspaceStore.getState().setCurrentWorkspaceId("ws-1");
    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("ws-1");
    useWorkspaceStore.getState().setCurrentWorkspaceId("ws-2");
    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("ws-2");
  });

  it("setWorkspaces는 목록 캐시를 교체하고 current가 없으면 첫 항목 선택", () => {
    useWorkspaceStore.getState().setWorkspaces([
      ws({ workspaceId: "ws-1", name: "A" }),
      ws({ workspaceId: "ws-2", name: "B" }),
    ]);
    const state = useWorkspaceStore.getState();
    expect(state.workspaces).toHaveLength(2);
    expect(state.currentWorkspaceId).toBe("ws-1");
  });

  it("setWorkspaces는 기존 currentWorkspaceId가 목록에 있으면 유지", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-2", workspaces: [] });
    useWorkspaceStore.getState().setWorkspaces([
      ws({ workspaceId: "ws-1", name: "A" }),
      ws({ workspaceId: "ws-2", name: "B" }),
    ]);
    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("ws-2");
  });

  it("setWorkspaces([])는 목록·선택을 바꾸지 않는다", () => {
    const list = [ws({ workspaceId: "ws-1", name: "A" })];
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-1", workspaces: list });
    useWorkspaceStore.getState().setWorkspaces([]);
    const s = useWorkspaceStore.getState();
    expect(s.currentWorkspaceId).toBe("ws-1");
    expect(s.workspaces).toEqual(list);
  });

  it("upsertWorkspace는 기존 항목 수정, 없으면 추가", () => {
    useWorkspaceStore.getState().setWorkspaces([ws({ workspaceId: "ws-1", name: "A" })]);
    useWorkspaceStore.getState().upsertWorkspace(
      ws({ workspaceId: "ws-1", name: "A-Updated", myEffectiveLevel: "view" }),
    );
    expect(useWorkspaceStore.getState().workspaces[0]?.name).toBe("A-Updated");

    useWorkspaceStore.getState().upsertWorkspace(ws({ workspaceId: "ws-2", name: "B" }));
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(2);
  });

  it("removeWorkspace는 현재 선택된 워크스페이스 제거 시 다음 항목으로 이동", () => {
    useWorkspaceStore.getState().setWorkspaces([
      ws({ workspaceId: "ws-1", name: "A" }),
      ws({ workspaceId: "ws-2", name: "B" }),
    ]);
    useWorkspaceStore.getState().setCurrentWorkspaceId("ws-1");
    useWorkspaceStore.getState().removeWorkspace("ws-1");

    const state = useWorkspaceStore.getState();
    expect(state.workspaces.map((w) => w.workspaceId)).toEqual(["ws-2"]);
    expect(state.currentWorkspaceId).toBe("ws-2");
  });
});
