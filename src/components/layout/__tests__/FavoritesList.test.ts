import { describe, expect, it } from "vitest";
import { getRevokedFavoritePageIds } from "../favoritesAccess";
import type { FavoritePageMeta } from "../../../store/settingsStore";
import type { WorkspaceSummary } from "../../../store/workspaceStore";

function favoriteMeta(workspaceId: string): FavoritePageMeta {
  return {
    pageId: "p1",
    workspaceId,
    workspaceName: "Workspace",
    pageTitle: "Page",
    pageIcon: null,
  };
}

function workspace(workspaceId: string): WorkspaceSummary {
  return {
    workspaceId,
    name: "Workspace",
    type: "shared",
    ownerMemberId: "m1",
    myEffectiveLevel: "edit",
  };
}

describe("getRevokedFavoritePageIds", () => {
  it("워크스페이스 목록 로딩 전 빈 배열 상태에서는 즐겨찾기를 제거하지 않는다", () => {
    expect(
      getRevokedFavoritePageIds(
        ["p1"],
        { p1: favoriteMeta("ws-1") },
        [],
      ),
    ).toEqual([]);
  });

  it("워크스페이스 목록 로딩 후 접근할 수 없는 항목만 제거 대상으로 반환한다", () => {
    expect(
      getRevokedFavoritePageIds(
        ["p1", "p2"],
        {
          p1: favoriteMeta("ws-1"),
          p2: favoriteMeta("ws-2"),
        },
        [workspace("ws-1")],
      ),
    ).toEqual(["p2"]);
  });
});
