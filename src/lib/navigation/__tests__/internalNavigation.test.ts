import { beforeEach, describe, expect, it } from "vitest";
import { usePageStore } from "../../../store/pageStore";
import { useSettingsStore } from "../../../store/settingsStore";
import {
  openDatabaseInNewTab,
  openPageInNewTab,
  shouldOpenInternalLinkInNewTab,
} from "../internalNavigation";

describe("internalNavigation", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      tabs: [{ pageId: "page-1", databaseId: null }],
      activeTabIndex: 0,
    });
    usePageStore.setState({ activePageId: "page-1" });
  });

  it("Ctrl 또는 Cmd 클릭을 새 탭 요청으로 판정한다", () => {
    expect(shouldOpenInternalLinkInNewTab({ ctrlKey: true })).toBe(true);
    expect(shouldOpenInternalLinkInNewTab({ metaKey: true })).toBe(true);
    expect(shouldOpenInternalLinkInNewTab({})).toBe(false);
  });

  it("페이지를 새 탭으로 열고 활성 페이지를 갱신한다", () => {
    openPageInNewTab("page-2");

    expect(useSettingsStore.getState().tabs).toEqual([
      { pageId: "page-1", databaseId: null },
      { pageId: "page-2", databaseId: null },
    ]);
    expect(useSettingsStore.getState().activeTabIndex).toBe(1);
    expect(usePageStore.getState().activePageId).toBe("page-2");
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
