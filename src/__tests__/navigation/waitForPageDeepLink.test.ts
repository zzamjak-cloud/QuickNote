import { describe, it, expect, beforeEach } from "vitest";
import { waitForPageDeepLink } from "../../lib/navigation/waitForPageDeepLink";
import { usePageStore } from "../../store/pageStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import type { Page } from "../../types/page";

const minimalPage = (id: string): Page => ({
  id,
  title: "t",
  icon: null,
  doc: { type: "doc", content: [] },
  parentId: null,
  order: 0,
  createdAt: 1,
  updatedAt: 1,
});

describe("waitForPageDeepLink", () => {
  beforeEach(() => {
    localStorage.clear();
    useWorkspaceStore.setState({ currentWorkspaceId: null, workspaces: [] });
    usePageStore.setState({
      pages: {},
      activePageId: null,
      cacheWorkspaceId: null,
    });
  });

  it("이미 조건을 만족하면 즉시 true", async () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-1" });
    usePageStore.setState({
      pages: { p1: minimalPage("p1") },
    });
    await expect(
      waitForPageDeepLink({ pageId: "p1", workspaceId: "ws-1" }),
    ).resolves.toBe(true);
  });

  it("대기 중 스토어에 페이지가 들어오면 true", async () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-1" });
    const p = waitForPageDeepLink({ pageId: "p1", workspaceId: "ws-1" });
    usePageStore.setState({
      pages: { p1: minimalPage("p1") },
    });
    await expect(p).resolves.toBe(true);
  });

  it("기대 워크스페이스와 다르면 타임아웃 시 false", async () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-1" });
    usePageStore.setState({ pages: { p1: minimalPage("p1") } });
    await expect(
      waitForPageDeepLink({
        pageId: "p1",
        workspaceId: "ws-2",
        timeoutMs: 40,
      }),
    ).resolves.toBe(false);
  });
});
