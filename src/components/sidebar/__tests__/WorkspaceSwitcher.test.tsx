import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { WorkspaceSwitcher } from "../WorkspaceSwitcher";
import { useWorkspaceStore } from "../../../store/workspaceStore";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../../lib/scheduler/scope";

describe("WorkspaceSwitcher", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      currentWorkspaceId: "ws-1",
      workspaces: [],
    });
    useWorkspaceStore.getState().setWorkspaces([
      {
        workspaceId: "ws-1",
        name: "Workspace A",
        type: "shared",
        ownerMemberId: "m-1",
        myEffectiveLevel: "edit",
      },
      {
        workspaceId: "ws-2",
        name: "Workspace B",
        type: "shared",
        ownerMemberId: "m-1",
        myEffectiveLevel: "view",
      },
    ]);
  });

  it("워크스페이스 목록을 렌더링하고 선택 변경 시 currentWorkspaceId를 갱신한다", () => {
    render(<WorkspaceSwitcher />);
    const select = screen.getByLabelText("워크스페이스 선택") as HTMLSelectElement;
    expect(select.value).toBe("ws-1");
    expect(screen.getByText("LC 스케줄러")).toBeTruthy();
    expect(screen.getByText("Workspace A")).toBeTruthy();
    expect(screen.getByText("Workspace B (view)")).toBeTruthy();

    fireEvent.change(select, { target: { value: "ws-2" } });
    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("ws-2");
  });

  it("LC 스케줄러 워크스페이스를 선택할 수 있다", () => {
    render(<WorkspaceSwitcher />);
    const select = screen.getByLabelText("워크스페이스 선택") as HTMLSelectElement;

    fireEvent.change(select, { target: { value: LC_SCHEDULER_WORKSPACE_ID } });

    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe(LC_SCHEDULER_WORKSPACE_ID);
  });

  it("view-only 워크스페이스가 선택되면 잠금 힌트를 노출한다", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-2" });
    render(<WorkspaceSwitcher />);
    expect(screen.getByText("view-only")).toBeTruthy();
  });
});
