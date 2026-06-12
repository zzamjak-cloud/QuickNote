import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../../lib/scheduler/scope";
import { ensurePageContentLoaded } from "../../../lib/sync/pageContentLoad";
import { useUiStore } from "../../../store/uiStore";
import { useOpenSchedulePage } from "../useOpenSchedulePage";

vi.mock("../../../lib/sync/pageContentLoad", () => ({
  ensurePageContentLoaded: vi.fn(),
}));

const ensurePageContentLoadedMock = vi.mocked(ensurePageContentLoaded);

function HookProbe({
  onReady,
}: {
  onReady: (openSchedulePage: ReturnType<typeof useOpenSchedulePage>) => void;
}) {
  const openSchedulePage = useOpenSchedulePage(LC_SCHEDULER_WORKSPACE_ID);
  onReady(openSchedulePage);
  return null;
}

describe("useOpenSchedulePage", () => {
  beforeEach(() => {
    ensurePageContentLoadedMock.mockReset();
    useUiStore.setState({ peekPageId: null, peekHistory: [], toasts: [] });
  });

  it("loads the schedule source page before opening the picker", async () => {
    ensurePageContentLoadedMock.mockResolvedValueOnce(true);
    let openSchedulePage: ReturnType<typeof useOpenSchedulePage> | null = null;
    render(<HookProbe onReady={(value) => { openSchedulePage = value; }} />);

    await act(async () => {
      await openSchedulePage?.("task-page-1::member-1");
    });

    expect(ensurePageContentLoadedMock).toHaveBeenCalledWith({
      pageId: "task-page-1",
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
      source: "lc-scheduler-schedule-open",
    });
    expect(useUiStore.getState().peekPageId).toBe("task-page-1");
  });

  it("does not open the picker when content loading fails", async () => {
    ensurePageContentLoadedMock.mockResolvedValueOnce(false);
    let openSchedulePage: ReturnType<typeof useOpenSchedulePage> | null = null;
    render(<HookProbe onReady={(value) => { openSchedulePage = value; }} />);

    await act(async () => {
      await openSchedulePage?.("task-page-2::member-1");
    });

    expect(useUiStore.getState().peekPageId).toBeNull();
    expect(useUiStore.getState().toasts.at(-1)?.kind).toBe("error");
  });
});
