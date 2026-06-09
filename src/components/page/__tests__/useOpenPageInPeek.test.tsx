import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensurePageContentLoaded } from "../../../lib/sync/pageContentLoad";
import { usePageStore } from "../../../store/pageStore";
import { useUiStore } from "../../../store/uiStore";
import { useWorkspaceStore } from "../../../store/workspaceStore";
import { useOpenPageInPeek } from "../useOpenPageInPeek";

vi.mock("../../../lib/sync/pageContentLoad", () => ({
  ensurePageContentLoaded: vi.fn(),
}));

const ensurePageContentLoadedMock = vi.mocked(ensurePageContentLoaded);

function HookProbe({
  onReady,
}: {
  onReady: (openPageInPeek: ReturnType<typeof useOpenPageInPeek>) => void;
}) {
  const openPageInPeek = useOpenPageInPeek();
  onReady(openPageInPeek);
  return null;
}

describe("useOpenPageInPeek", () => {
  beforeEach(() => {
    ensurePageContentLoadedMock.mockReset();
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-current" });
    usePageStore.setState({ pages: {} });
    useUiStore.setState({
      peekPageId: null,
      peekHistory: [],
      toasts: [],
      databaseTreeFocusRequest: null,
    });
  });

  it("일반 페이지를 불러온 뒤 피크뷰로 연다", async () => {
    usePageStore.setState({
      pages: {
        "page-1": {
          id: "page-1",
          workspaceId: "ws-remote",
          title: "Page 1",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 0,
          createdAt: 1,
          updatedAt: 1,
          contentLoaded: false,
        },
      },
    });
    ensurePageContentLoadedMock.mockResolvedValueOnce(true);

    let openPageInPeek: ReturnType<typeof useOpenPageInPeek> | null = null;
    render(<HookProbe onReady={(value) => { openPageInPeek = value; }} />);

    await act(async () => {
      await openPageInPeek?.("page-1", { source: "test-open-page" });
    });

    expect(ensurePageContentLoadedMock).toHaveBeenCalledWith({
      pageId: "page-1",
      workspaceId: "ws-remote",
      source: "test-open-page",
    });
    expect(useUiStore.getState().peekPageId).toBe("page-1");
  });

  it("피크 내부에서는 peekNavigate를 사용한다", async () => {
    useUiStore.setState({ peekPageId: "host-page", peekHistory: [] });
    usePageStore.setState({
      pages: {
        "page-2": {
          id: "page-2",
          workspaceId: "ws-current",
          title: "Page 2",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 0,
          createdAt: 1,
          updatedAt: 1,
          contentLoaded: true,
        },
      },
    });
    ensurePageContentLoadedMock.mockResolvedValueOnce(true);

    let openPageInPeek: ReturnType<typeof useOpenPageInPeek> | null = null;
    render(<HookProbe onReady={(value) => { openPageInPeek = value; }} />);

    await act(async () => {
      await openPageInPeek?.("page-2", {
        source: "test-open-page-in-peek",
        navigateInPeek: true,
      });
    });

    expect(useUiStore.getState().peekPageId).toBe("page-2");
    expect(useUiStore.getState().peekHistory).toEqual(["host-page"]);
  });

  it("불러오기에 실패하면 피크를 열지 않고 토스트를 띄운다", async () => {
    ensurePageContentLoadedMock.mockResolvedValueOnce(false);

    let openPageInPeek: ReturnType<typeof useOpenPageInPeek> | null = null;
    render(<HookProbe onReady={(value) => { openPageInPeek = value; }} />);

    await act(async () => {
      await openPageInPeek?.("missing-page", { source: "test-open-missing" });
    });

    expect(useUiStore.getState().peekPageId).toBeNull();
    expect(useUiStore.getState().toasts.at(-1)?.message).toBe(
      "페이지를 불러오지 못했습니다.",
    );
  });
});
