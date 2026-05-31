import { beforeEach, describe, expect, it } from "vitest";
import {
  makeInlineControlsPrefsKey,
  useDatabaseInlineUiPrefsStore,
} from "../databaseInlineUiPrefsStore";

describe("databaseInlineUiPrefsStore", () => {
  beforeEach(() => {
    useDatabaseInlineUiPrefsStore.setState({ inlineControlsCollapsedByKey: {} });
  });

  it("워크스페이스와 사용자별로 인라인 접힘 상태를 분리 저장한다", () => {
    const store = useDatabaseInlineUiPrefsStore.getState();

    store.setInlineControlsCollapsed(
      { workspaceId: "ws-a", memberId: "member-a", databaseId: "db-1" },
      true,
    );

    store.setInlineControlsCollapsed(
      { workspaceId: "ws-a", memberId: "member-b", databaseId: "db-1" },
      false,
    );

    const keyA = makeInlineControlsPrefsKey({
      workspaceId: "ws-a",
      memberId: "member-a",
      databaseId: "db-1",
    });
    const keyB = makeInlineControlsPrefsKey({
      workspaceId: "ws-a",
      memberId: "member-b",
      databaseId: "db-1",
    });

    const next = useDatabaseInlineUiPrefsStore.getState().inlineControlsCollapsedByKey;
    expect(next[keyA]).toBe(true);
    expect(next[keyB]).toBe(false);
  });

  it("memberId/workspaceId가 없으면 fallback key를 사용한다", () => {
    const key = makeInlineControlsPrefsKey({
      workspaceId: null,
      memberId: null,
      databaseId: "db-1",
    });
    expect(key).toBe("local::anonymous::db-1");
  });
});
