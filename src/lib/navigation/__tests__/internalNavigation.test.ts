import { beforeEach, describe, expect, it } from "vitest";
import { usePageStore } from "../../../store/pageStore";
import { useSettingsStore } from "../../../store/settingsStore";
import type { Page } from "../../../types/page";
import {
  openDatabaseInNewTab,
  openPageInCurrentTab,
  openPageInNewTab,
  shouldOpenInternalLinkInNewTab,
} from "../internalNavigation";

function page(id: string): Page {
  return {
    id,
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

  it("없는 페이지 링크는 탭이나 페이지를 바꾸지 않는다", () => {
    expect(openPageInCurrentTab("missing-page")).toBe(false);
    expect(openPageInNewTab("missing-page")).toBe(false);

    expect(useSettingsStore.getState().tabs).toEqual([
      { pageId: "page-1", databaseId: null },
    ]);
    expect(usePageStore.getState().activePageId).toBe("page-1");
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
