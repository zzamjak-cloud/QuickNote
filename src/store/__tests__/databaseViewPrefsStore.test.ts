import { beforeEach, describe, expect, it } from "vitest";
import { useDatabaseViewPrefsStore } from "../databaseViewPrefsStore";
import { useWorkspaceStore } from "../workspaceStore";

describe("databaseViewPrefsStore", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ currentWorkspaceId: null, workspaces: [] });
    useDatabaseViewPrefsStore.setState({ panelStateByKey: {} });
  });

  it("keeps DB filter/sort/property visibility prefs local per workspace and database", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-a" });

    useDatabaseViewPrefsStore.getState().patchPanelState("db-1", {
      searchQuery: "mine",
      sortRules: [{ columnId: "title", dir: "desc" }],
      viewConfigs: { table: { visibleColumnIds: ["title"] } },
    });

    expect(useDatabaseViewPrefsStore.getState().getPanelState("db-1")).toMatchObject({
      searchQuery: "mine",
      sortRules: [{ columnId: "title", dir: "desc" }],
      viewConfigs: { table: { visibleColumnIds: ["title"] } },
    });

    useWorkspaceStore.setState({ currentWorkspaceId: "ws-b" });
    expect(useDatabaseViewPrefsStore.getState().getPanelState("db-1")).toMatchObject({
      searchQuery: "",
      sortRules: [],
      viewConfigs: {},
    });
  });

  it("uses legacy panelState JSON only as an initial local fallback", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-a" });
    const legacy = JSON.stringify({ searchQuery: "legacy" });

    expect(
      useDatabaseViewPrefsStore.getState().getPanelState("db-1", legacy).searchQuery,
    ).toBe("legacy");

    useDatabaseViewPrefsStore
      .getState()
      .patchPanelState("db-1", { searchQuery: "local" }, legacy);

    expect(
      useDatabaseViewPrefsStore.getState().getPanelState("db-1", legacy).searchQuery,
    ).toBe("local");
  });
});
