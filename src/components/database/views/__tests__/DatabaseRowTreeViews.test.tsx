import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPanelState } from "../../../../types/database";
import { useDatabaseStore } from "../../../../store/databaseStore";
import { usePageStore } from "../../../../store/pageStore";
import { useUiStore } from "../../../../store/uiStore";
import { useWorkspaceStore } from "../../../../store/workspaceStore";
import { useDatabasePageTreeCollapseStore } from "../../../../store/databasePageTreeCollapseStore";
import { DatabaseListView } from "../DatabaseListView";
import { DatabaseTableView } from "../DatabaseTableView";

vi.mock("../../../common/IconPicker", () => ({
  IconPicker: () => <span data-testid="icon-picker" />,
}));

vi.mock("../../DatabaseColumnHeader", () => ({
  DatabaseColumnHeader: ({ column }: { column: { name: string } }) => <th>{column.name}</th>,
}));

vi.mock("../../DatabaseAddColumnButton", () => ({
  DatabaseAddColumnButton: () => null,
}));

describe("database row tree views", () => {
  beforeEach(() => {
    localStorage.clear();
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-1" });
    useDatabasePageTreeCollapseStore.setState({ collapsedByKey: {} });
    useUiStore.setState({
      peekPageId: null,
      peekHistory: [],
      toasts: [],
      databaseTreeFocusRequest: null,
    });
    useDatabaseStore.setState({
      databases: {
        "db-1": {
          meta: {
            id: "db-1",
            title: "DB 1",
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [{ id: "title", name: "제목", type: "title" }],
          rowPageOrder: ["row-1"],
        },
      },
      cacheWorkspaceId: "ws-1",
    });
    usePageStore.setState({
      pages: {
        "row-1": {
          id: "row-1",
          workspaceId: "ws-1",
          title: "Row 1",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 0,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "db-1",
          dbCells: {},
        },
        child: {
          id: "child",
          workspaceId: "ws-1",
          title: "Child",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: "row-1",
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
        grandchild: {
          id: "grandchild",
          workspaceId: "ws-1",
          title: "Grandchild",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: "child",
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      activePageId: null,
    });
  });

  it("list view는 기본으로 접힌 상태에서 시작하고 단계별로 펼친다", async () => {
    render(
      <DatabaseListView
        databaseId="db-1"
        panelState={emptyPanelState()}
        setPanelState={() => {}}
      />,
    );

    expect(screen.queryByText("Child")).not.toBeInTheDocument();
    expect(screen.queryByText("Grandchild")).not.toBeInTheDocument();
    expect(screen.queryByText("새 하위 페이지")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("하위 페이지 펼치기"));
    await waitFor(() => {
      expect(screen.getByText("Child")).toBeInTheDocument();
    });
    expect(screen.queryByText("Grandchild")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByLabelText("하위 페이지 펼치기")[0]!);
    await waitFor(() => {
      expect(screen.getByText("Grandchild")).toBeInTheDocument();
    });
  });

  it("table view는 기본으로 접힌 상태에서 시작하고 단계별로 펼친다", async () => {
    render(
      <DatabaseTableView
        databaseId="db-1"
        panelState={emptyPanelState()}
        setPanelState={() => {}}
      />,
    );

    expect(screen.queryByText("Child")).not.toBeInTheDocument();
    expect(screen.queryByText("Grandchild")).not.toBeInTheDocument();
    expect(screen.queryByText("새 하위 페이지")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("하위 페이지 펼치기"));
    await waitFor(() => {
      expect(screen.getByText("Child")).toBeInTheDocument();
    });
    expect(screen.queryByText("Grandchild")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByLabelText("하위 페이지 펼치기")[0]!);
    await waitFor(() => {
      expect(screen.getByText("Grandchild")).toBeInTheDocument();
    });
  });

  it("focus request가 오면 list view 루트 폴딩을 자동으로 펼친다", async () => {
    useUiStore.setState({
      databaseTreeFocusRequest: {
        databaseId: "db-1",
        pageId: "child",
        requestedAt: Date.now(),
      },
    });

    render(
      <DatabaseListView
        databaseId="db-1"
        panelState={emptyPanelState()}
        setPanelState={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Child")).toBeInTheDocument();
    });
  });
});
