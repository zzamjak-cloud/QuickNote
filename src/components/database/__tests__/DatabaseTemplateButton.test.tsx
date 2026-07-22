import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDatabaseStore } from "../../../store/databaseStore";
import { usePageStore } from "../../../store/pageStore";
import { useWorkspaceStore } from "../../../store/workspaceStore";
import { DatabaseTemplateButton } from "../DatabaseTemplateButton";

const { enqueueAsync } = vi.hoisted(() => ({ enqueueAsync: vi.fn() }));

vi.mock("../../../lib/sync/runtime", () => ({ enqueueAsync }));
vi.mock("../../../hooks/useAnchoredPopover", () => ({
  useAnchoredPopover: () => ({
    buttonRef: { current: null },
    popoverRef: { current: null },
    open: true,
    coords: { top: 0, left: 0 },
    toggle: vi.fn(),
    close: vi.fn(),
  }),
}));
vi.mock("../useOpenDatabaseRow", () => ({
  useAddDatabaseRowAndOpen: () => vi.fn(),
  useOpenDatabaseRow: () => vi.fn(),
}));

describe("DatabaseTemplateButton", () => {
  beforeEach(() => {
    enqueueAsync.mockClear();
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-1" });
    usePageStore.setState({ pages: {}, activePageId: null, cacheWorkspaceId: "ws-1" });
    useDatabaseStore.setState({
      databases: {
        "db-1": {
          meta: {
            id: "db-1",
            workspaceId: "ws-1",
            title: "작업 DB",
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [{ id: "title", name: "제목", type: "title" }],
          presets: [],
          panelState: {},
          rowPageOrder: [],
        },
      },
      dbTemplates: {},
      cacheWorkspaceId: "ws-1",
    });
  });

  it("생성·제목 편집을 새로고침 없이 템플릿 목록에 반영한다", () => {
    render(<DatabaseTemplateButton databaseId="db-1" />);

    fireEvent.click(screen.getByRole("button", { name: "새 템플릿" }));

    const template = useDatabaseStore.getState().dbTemplates["db-1"]?.[0];
    expect(template?.pageId).toBeTruthy();
    expect(screen.getAllByText("새 템플릿")).toHaveLength(2);

    act(() => {
      usePageStore.getState().renamePage(template!.pageId!, "주간 회고");
    });

    expect(screen.getByRole("button", { name: "주간 회고" })).toBeInTheDocument();
  });
});
