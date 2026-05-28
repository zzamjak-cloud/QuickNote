import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "../settingsStore";

describe("settingsStore database tabs", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      tabs: [{ pageId: null }],
      activeTabIndex: 0,
    });
  });

  it("opens a database in the current tab without assigning a page id", () => {
    useSettingsStore.getState().setCurrentTabDatabase("db-1");

    expect(useSettingsStore.getState().tabs[0]).toMatchObject({
      pageId: null,
      databaseId: "db-1",
    });
  });

  it("clears the database target when a page is opened in the same tab", () => {
    useSettingsStore.getState().setCurrentTabDatabase("db-1");
    useSettingsStore.getState().setCurrentTabPage("page-1");

    expect(useSettingsStore.getState().tabs[0]).toMatchObject({
      pageId: "page-1",
      databaseId: null,
    });
  });
});
