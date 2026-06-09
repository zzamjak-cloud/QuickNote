import { describe, expect, it } from "vitest";
import { shouldAutoEnsureFullPageDatabaseHome } from "../shouldAutoEnsureFullPageDatabaseHome";

describe("shouldAutoEnsureFullPageDatabaseHome", () => {
  it("페이지 메타 구조 캐시가 완성되기 전에는 auto ensure를 막는다", () => {
    expect(
      shouldAutoEnsureFullPageDatabaseHome({
        currentWorkspaceId: "ws-1",
        pageMetaLoading: true,
        pageMetaNextToken: null,
        tabDatabaseId: "db-1",
        tabDatabasePageId: null,
        tabDatabaseTitle: "DB 1",
        workspaceBootstrapping: false,
        isProtectedDatabase: false,
      }),
    ).toBe(false);

    expect(
      shouldAutoEnsureFullPageDatabaseHome({
        currentWorkspaceId: "ws-1",
        pageMetaLoading: false,
        pageMetaNextToken: "next-token",
        tabDatabaseId: "db-1",
        tabDatabasePageId: null,
        tabDatabaseTitle: "DB 1",
        workspaceBootstrapping: false,
        isProtectedDatabase: false,
      }),
    ).toBe(false);
  });

  it("부트스트랩 중이거나 이미 홈 페이지가 있으면 auto ensure를 막는다", () => {
    expect(
      shouldAutoEnsureFullPageDatabaseHome({
        currentWorkspaceId: "ws-1",
        pageMetaLoading: false,
        pageMetaNextToken: null,
        tabDatabaseId: "db-1",
        tabDatabasePageId: null,
        tabDatabaseTitle: "DB 1",
        workspaceBootstrapping: true,
        isProtectedDatabase: false,
      }),
    ).toBe(false);

    expect(
      shouldAutoEnsureFullPageDatabaseHome({
        currentWorkspaceId: "ws-1",
        pageMetaLoading: false,
        pageMetaNextToken: null,
        tabDatabaseId: "db-1",
        tabDatabasePageId: "page-full",
        tabDatabaseTitle: "DB 1",
        workspaceBootstrapping: false,
        isProtectedDatabase: false,
      }),
    ).toBe(false);
  });

  it("구조 캐시가 준비된 뒤에만 auto ensure를 허용한다", () => {
    expect(
      shouldAutoEnsureFullPageDatabaseHome({
        currentWorkspaceId: "ws-1",
        pageMetaLoading: false,
        pageMetaNextToken: null,
        tabDatabaseId: "db-1",
        tabDatabasePageId: null,
        tabDatabaseTitle: "DB 1",
        workspaceBootstrapping: false,
        isProtectedDatabase: false,
      }),
    ).toBe(true);
  });
});
