import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../../lib/scheduler/scope";
import { useSettingsStore } from "../../../store/settingsStore";
import { useWorkspaceStore } from "../../../store/workspaceStore";
import { TabBar } from "../TabBar";

describe("TabBar", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      tabs: [{ pageId: null }],
      activeTabIndex: 0,
    });
    useWorkspaceStore.setState({
      currentWorkspaceId: "ws-personal",
      workspaces: [
        {
          workspaceId: "ws-personal",
          name: "개인 워크스페이스",
          type: "personal",
          ownerMemberId: "m-1",
          myEffectiveLevel: "edit",
        },
      ],
    });
  });

  it("스케줄러 모달이 닫혀 있으면 닫기 이벤트로 워크스페이스를 변경하지 않는다", () => {
    render(<TabBar />);

    act(() => {
      window.dispatchEvent(new CustomEvent("quicknote:close-lc-scheduler", {
        detail: { keepSchedulerWorkspace: true },
      }));
    });

    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("ws-personal");
    expect(useWorkspaceStore.getState().currentWorkspaceId).not.toBe(LC_SCHEDULER_WORKSPACE_ID);
  });
});
