import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../../lib/scheduler/scope";
import { usePageStore } from "../../../store/pageStore";
import { useSchedulerViewStore } from "../../../store/schedulerViewStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { useWorkspaceStore } from "../../../store/workspaceStore";
import { TabBar } from "../TabBar";

vi.mock("../../scheduler/LCSchedulerModal", () => ({
  LCSchedulerModal: ({ onClose }: { onClose: () => void }) => (
    <div data-lc-scheduler-modal="true">
      <button type="button" onClick={onClose}>
        닫기
      </button>
    </div>
  ),
}));

describe("TabBar", () => {
  beforeEach(() => {
    window.history.replaceState({ qnPage: "initial-page" }, "", "/?page=initial-page");
    useSettingsStore.setState({
      tabs: [{ pageId: null }],
      activeTabIndex: 0,
      lastClosedTab: null,
    });
    usePageStore.setState({
      pages: {},
      activePageId: null,
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
    useSchedulerViewStore.setState({ schedulerOpen: false });
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

  it("LC 스케줄러 모달이 열려 있으면 브라우저 뒤로가기로 앱을 벗어나지 않고 모달만 닫는다", async () => {
    useSchedulerViewStore.setState({ schedulerOpen: true });

    render(<TabBar />);

    await waitFor(() => {
      expect(window.history.state).toMatchObject({ qnLCSchedulerModal: true });
    });

    act(() => {
      window.dispatchEvent(
        new PopStateEvent("popstate", {
          state: { qnPage: "initial-page" },
        }),
      );
    });

    expect(useSchedulerViewStore.getState().schedulerOpen).toBe(false);
    expect(window.location.search).toBe("?page=initial-page");
  });

  it("탭 클릭 영역은 포인터와 press scale 피드백을 사용한다", () => {
    render(<TabBar />);

    const tabButton = screen.getByRole("button", { name: "빈 탭" });
    expect(tabButton.className).toContain("cursor-pointer");
    expect(tabButton.className).toContain("active:scale-[0.985]");
  });

  it("탭 우클릭 시 퀵노트 컨텍스트 메뉴에서 탭을 복제한다", () => {
    usePageStore.setState({
      pages: {
        "page-1": {
          id: "page-1",
          title: "문서 1",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      activePageId: "page-1",
    });
    useSettingsStore.setState({
      tabs: [{ pageId: "page-1", databaseId: null }],
      activeTabIndex: 0,
    });
    render(<TabBar />);

    fireEvent.contextMenu(screen.getByRole("button", { name: "문서 1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "탭복제" }));

    expect(useSettingsStore.getState().tabs).toHaveLength(2);
    expect(useSettingsStore.getState().tabs[1]).toMatchObject({ pageId: "page-1" });
    expect(useSettingsStore.getState().activeTabIndex).toBe(1);
  });

  it("탭 우클릭 메뉴에서 현재 탭만 새로고침한다", () => {
    usePageStore.setState({
      pages: {
        "page-1": {
          id: "page-1",
          title: "문서 1",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
        "page-2": {
          id: "page-2",
          title: "문서 2",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      activePageId: "page-1",
    });
    useSettingsStore.setState({
      tabs: [
        { pageId: "page-1", databaseId: null },
        { pageId: "page-2", databaseId: null },
      ],
      activeTabIndex: 0,
    });
    render(<TabBar />);

    fireEvent.contextMenu(screen.getByRole("button", { name: "문서 1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "탭 새로고침" }));

    expect((useSettingsStore.getState().tabs[0] as { refreshKey?: number })?.refreshKey).toBe(1);
    expect((useSettingsStore.getState().tabs[1] as { refreshKey?: number })?.refreshKey).toBeUndefined();
    expect(useSettingsStore.getState().activeTabIndex).toBe(0);
  });

  it("탭 우클릭 메뉴에서 마지막으로 닫은 탭을 다시 연다", () => {
    useSettingsStore.setState({
      tabs: [{ pageId: "page-1" }, { pageId: "page-2" }],
      activeTabIndex: 0,
    });
    usePageStore.setState({
      pages: {
        "page-1": {
          id: "page-1",
          title: "문서 1",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
        "page-2": {
          id: "page-2",
          title: "문서 2",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      activePageId: "page-1",
    });
    render(<TabBar />);

    fireEvent.click(screen.getByRole("button", { name: "탭 닫기: 문서 1" }));
    fireEvent.contextMenu(screen.getByRole("button", { name: "문서 2" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "마지막으로 닫은 탭 다시 열기" }));

    expect(useSettingsStore.getState().tabs).toHaveLength(2);
    expect(useSettingsStore.getState().tabs[0]).toMatchObject({ pageId: "page-1" });
    expect(useSettingsStore.getState().activeTabIndex).toBe(0);
    expect((useSettingsStore.getState() as { lastClosedTab?: unknown }).lastClosedTab).toBeNull();
  });

  it("상단 X 버튼으로 탭을 닫고 마지막 탭은 닫기 버튼을 숨긴다", () => {
    useSettingsStore.setState({
      tabs: [{ pageId: "page-1" }, { pageId: "page-2" }],
      activeTabIndex: 0,
    });
    usePageStore.setState({
      pages: {
        "page-1": {
          id: "page-1",
          title: "문서 1",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
        "page-2": {
          id: "page-2",
          title: "문서 2",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      activePageId: "page-1",
    });
    render(<TabBar />);

    fireEvent.click(screen.getByRole("button", { name: "탭 닫기: 문서 1" }));

    expect(useSettingsStore.getState().tabs).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "탭 닫기: 문서 2" })).toBeNull();
  });
});
