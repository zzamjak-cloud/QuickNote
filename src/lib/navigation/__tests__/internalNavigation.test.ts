import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePageStore } from "../../../store/pageStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { useUiStore } from "../../../store/uiStore";
import { useWorkspaceStore } from "../../../store/workspaceStore";
import type { Page } from "../../../types/page";

const requestCrossWorkspaceLanding = vi.fn();
vi.mock("../../sync/workspaceLanding", () => ({
  requestCrossWorkspaceLanding: (...args: unknown[]) => requestCrossWorkspaceLanding(...args),
}));
const ensurePageContentLoaded = vi.fn(async () => true);
vi.mock("../../sync/pageContentLoad", () => ({
  ensurePageContentLoaded: (...args: unknown[]) => ensurePageContentLoaded(...args),
}));
import {
  navigateToWorkspacePage,
  openDatabaseInNewTab,
  openPageInCurrentTab,
  openPageInNewTab,
  shouldOpenInternalLinkInNewTab,
} from "../internalNavigation";

function page(id: string, workspaceId?: string): Page {
  return {
    id,
    workspaceId,
    title: id,
    icon: null,
    doc: { type: "doc", content: [] },
    parentId: null,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("internalNavigation", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      tabs: [{ pageId: "page-1", databaseId: null }],
      activeTabIndex: 0,
    });
    usePageStore.setState({
      pages: {
        "page-1": page("page-1"),
        "page-2": page("page-2"),
      },
      activePageId: "page-1",
    });
  });

  it("Ctrl 또는 Cmd 클릭을 새 탭 요청으로 판정한다", () => {
    expect(shouldOpenInternalLinkInNewTab({ ctrlKey: true })).toBe(true);
    expect(shouldOpenInternalLinkInNewTab({ metaKey: true })).toBe(true);
    expect(shouldOpenInternalLinkInNewTab({})).toBe(false);
  });

  it("페이지를 새 탭으로 열고 활성 페이지를 갱신한다", () => {
    expect(openPageInNewTab("page-2")).toBe(true);

    expect(useSettingsStore.getState().tabs).toEqual([
      { pageId: "page-1", databaseId: null },
      { pageId: "page-2", databaseId: null },
    ]);
    expect(useSettingsStore.getState().activeTabIndex).toBe(1);
    expect(usePageStore.getState().activePageId).toBe("page-2");
  });

  it("현재 탭에서 페이지를 열 때 DB 탭 상태를 반드시 해제한다", () => {
    useSettingsStore.getState().setCurrentTabDatabase("db-1");
    usePageStore.getState().setActivePage(null);

    expect(openPageInCurrentTab("page-2")).toBe(true);

    expect(useSettingsStore.getState().tabs[0]).toMatchObject({
      pageId: "page-2",
      databaseId: null,
    });
    expect(usePageStore.getState().activePageId).toBe("page-2");
  });

  it("로드되지 않은 페이지 링크(DB 항목 등)는 콘텐츠 로드를 시도한다", () => {
    // store 에 없는 같은 워크스페이스 페이지(DB 항목 페이지 등)는 콘텐츠를 로드한 뒤 연다.
    // (예전엔 false 로 무시했고, 그게 DB 항목 페이지 블록/페이지 링크가 안 되던 원인.)
    ensurePageContentLoaded.mockClear();
    expect(openPageInCurrentTab("missing-page")).toBe(true);
    expect(ensurePageContentLoaded).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: "missing-page" }),
    );

    // 로드는 비동기이므로 동기 시점에는 탭/활성 페이지가 바뀌지 않는다.
    expect(useSettingsStore.getState().tabs).toEqual([
      { pageId: "page-1", databaseId: null },
    ]);
    expect(usePageStore.getState().activePageId).toBe("page-1");
  });

  it("로컬에 없는 페이지 + workspaceId 힌트는 전환하지 않고 미리보기(peek)로 띄운다", async () => {
    requestCrossWorkspaceLanding.mockClear();
    ensurePageContentLoaded.mockClear();
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-current" });
    useUiStore.setState({ peekPageId: null });

    // 타 워크스페이스 링크를 붙여넣어 만든 버튼: 페이지가 현재 store 에 없어도 ws 로 콘텐츠 로드 후 peek.
    expect(
      openPageInCurrentTab("cross-page", { workspaceId: "ws-other" }),
    ).toBe(true);

    // 워크스페이스 전환·착지는 클릭 시점에 일어나지 않는다(peek 만).
    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("ws-current");
    expect(requestCrossWorkspaceLanding).not.toHaveBeenCalled();
    expect(ensurePageContentLoaded).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: "cross-page", workspaceId: "ws-other" }),
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(useUiStore.getState().peekPageId).toBe("cross-page");
  });

  it("로컬에 있지만 타 워크스페이스인 페이지도 전환 대신 peek 로 띄운다", () => {
    requestCrossWorkspaceLanding.mockClear();
    ensurePageContentLoaded.mockClear();
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-current" });
    usePageStore.setState({
      pages: { "page-x": page("page-x", "ws-other") },
      activePageId: "page-1",
    });

    expect(openPageInCurrentTab("page-x")).toBe(true);

    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("ws-current");
    expect(requestCrossWorkspaceLanding).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().tabs).toEqual([
      { pageId: "page-1", databaseId: null },
    ]);
  });

  it("navigateToWorkspacePage 는 워크스페이스 전환 + 착지 목표를 요청한다", () => {
    requestCrossWorkspaceLanding.mockClear();
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-current" });

    navigateToWorkspacePage("page-x", "ws-other");

    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("ws-other");
    expect(requestCrossWorkspaceLanding).toHaveBeenCalledWith("ws-other", "page-x");
  });

  it("DB를 새 탭으로 열고 페이지 활성 상태를 비운다", () => {
    openDatabaseInNewTab("db-1");

    expect(useSettingsStore.getState().tabs[1]).toMatchObject({
      pageId: null,
      databaseId: "db-1",
    });
    expect(usePageStore.getState().activePageId).toBeNull();
  });
});
