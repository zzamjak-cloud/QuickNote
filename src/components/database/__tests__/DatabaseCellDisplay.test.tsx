import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPanelState, type ColumnDef } from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useMemberStore } from "../../../store/memberStore";
import { usePageStore } from "../../../store/pageStore";
import { DatabaseCell } from "../DatabaseCell";
import { DatabaseCellDisplay } from "../DatabaseCellDisplay";
import { useProcessedRows } from "../useProcessedRows";

const originalUpdateCell = useDatabaseStore.getState().updateCell;

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

const automatedSelectColumn: ColumnDef = {
  id: "priority",
  name: "우선순위",
  type: "select",
  config: {
    sourceFromDb: {
      databaseId: "source-db",
      columnId: "source-priority",
      automation: true,
    },
  },
};

function setupAutomatedSelectFixture(
  sourceValue: string | string[] | null,
  updateCell = originalUpdateCell,
  options: {
    includeSourceRow?: boolean;
    manualValue?: string | string[] | null;
    sourceLinkValue?: string[];
  } = {},
) {
  const includeSourceRow = options.includeSourceRow ?? true;
  const manualValue = options.manualValue === undefined ? "manual-option" : options.manualValue;
  const sourceLinkValue = options.sourceLinkValue ?? ["source-row"];
  useDatabaseStore.setState({
    updateCell,
    databases: {
      "current-db": {
        meta: { id: "current-db", title: "현재 DB", createdAt: 1, updatedAt: 1 },
        columns: [
          { id: "title", name: "이름", type: "title" },
          {
            id: "source-link",
            name: "소스",
            type: "pageLink",
            config: { pageLinkScopeDatabaseId: "source-db" },
          },
          automatedSelectColumn,
        ],
        rowPageOrder: ["current-row"],
      },
      "source-db": {
        meta: { id: "source-db", title: "소스 DB", createdAt: 1, updatedAt: 1 },
        columns: [
          { id: "title", name: "이름", type: "title" },
          {
            id: "source-priority",
            name: "우선순위",
            type: "select",
            config: {
              options: [
                { id: "manual-option", label: "수동 선택" },
                { id: "auto-option", label: "자동 선택" },
              ],
            },
          },
        ],
        rowPageOrder: includeSourceRow ? ["source-row"] : [],
      },
    },
    cacheWorkspaceId: "ws-1",
  });
  usePageStore.setState({
    pages: {
      "current-row": {
        id: "current-row",
        workspaceId: "ws-1",
        title: "현재 행",
        icon: null,
        doc: { type: "doc", content: [] },
        parentId: null,
        order: 1,
        createdAt: 1,
        updatedAt: 1,
        databaseId: "current-db",
        dbCells: {
          "source-link": sourceLinkValue,
          priority: manualValue,
        },
      },
      ...(includeSourceRow
        ? {
            "source-row": {
              id: "source-row",
              workspaceId: "ws-1",
              title: "소스 행",
              icon: null,
              doc: { type: "doc", content: [] },
              parentId: null,
              order: 2,
              createdAt: 1,
              updatedAt: 1,
              databaseId: "source-db",
              dbCells: { "source-priority": sourceValue },
            },
          }
        : {}),
    },
    activePageId: null,
  });
}

const processedPanelState = emptyPanelState();

function ProcessedSelectCellProbe() {
  const { rows } = useProcessedRows("current-db", processedPanelState);
  const row = rows[0];
  if (!row) return null;
  return (
    <DatabaseCell
      databaseId="current-db"
      rowId="current-row"
      column={automatedSelectColumn}
      value={row.cells.priority ?? null}
    />
  );
}

describe("DatabaseCellDisplay", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    useDatabaseStore.setState({
      databases: {},
      cacheWorkspaceId: null,
      updateCell: originalUpdateCell,
    });
    usePageStore.setState({
      pages: {},
      activePageId: null,
    });
    useMemberStore.setState({
      members: [],
      cacheWorkspaceId: null,
      lastFetchedAt: null,
      mentionCandidates: [],
      mentionQuery: "",
    });
  });

  it("sourceFromDb가 pageLink 값을 가져와도 ID 대신 연결 페이지 제목을 표시한다", () => {
    const mirroredColumn: ColumnDef = {
      id: "mirrored-link",
      name: "연관작업",
      type: "text",
      config: {
        sourceFromDb: {
          databaseId: "source-db",
          columnId: "source-page-link",
          viaPageLinkColumnId: "source-row-link",
        },
      },
    };

    useDatabaseStore.setState({
      databases: {
        "current-db": {
          meta: { id: "current-db", title: "현재 DB", createdAt: 1, updatedAt: 1 },
          columns: [
            { id: "title", name: "이름", type: "title" },
            { id: "source-row-link", name: "소스", type: "pageLink" },
            mirroredColumn,
          ],
          rowPageOrder: ["current-row"],
        },
        "source-db": {
          meta: { id: "source-db", title: "소스 DB", createdAt: 1, updatedAt: 1 },
          columns: [
            { id: "title", name: "이름", type: "title" },
            { id: "source-page-link", name: "연결", type: "pageLink" },
          ],
          rowPageOrder: ["source-row"],
        },
      },
      cacheWorkspaceId: "ws-1",
    });
    usePageStore.setState({
      pages: {
        "current-row": {
          id: "current-row",
          workspaceId: "ws-1",
          title: "현재 행",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 1,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "current-db",
          dbCells: { "source-row-link": ["source-row"] },
        },
        "source-row": {
          id: "source-row",
          workspaceId: "ws-1",
          title: "소스 행",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 2,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "source-db",
          dbCells: { "source-page-link": ["linked-page-id"] },
        },
        "linked-page-id": {
          id: "linked-page-id",
          workspaceId: "ws-1",
          title: "연결된 작업",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 3,
          createdAt: 1,
          updatedAt: 1,
          dbCells: {},
        },
      },
      activePageId: null,
    });

    render(<DatabaseCellDisplay column={mirroredColumn} value={null} rowId="current-row" />);

    expect(screen.queryByText("연결된 작업")).not.toBeNull();
    expect(screen.queryByText("linked-page-id")).toBeNull();
  });

  it("sourceFromDb가 page ID 배열을 가져와도 원본 ID 대신 페이지 제목을 표시한다", () => {
    const mirroredColumn: ColumnDef = {
      id: "mirrored-link-title",
      name: "연관작업",
      type: "text",
      config: {
        sourceFromDb: {
          databaseId: "source-db",
          columnId: "source-text-with-page-id",
          viaPageLinkColumnId: "source-row-link",
        },
      },
    };

    useDatabaseStore.setState({
      databases: {
        "current-db": {
          meta: { id: "current-db", title: "현재 DB", createdAt: 1, updatedAt: 1 },
          columns: [
            { id: "title", name: "이름", type: "title" },
            { id: "source-row-link", name: "소스", type: "pageLink" },
            mirroredColumn,
          ],
          rowPageOrder: ["current-row"],
        },
        "source-db": {
          meta: { id: "source-db", title: "소스 DB", createdAt: 1, updatedAt: 1 },
          columns: [
            { id: "title", name: "이름", type: "title" },
            { id: "source-text-with-page-id", name: "연결", type: "text" },
          ],
          rowPageOrder: ["source-row"],
        },
      },
      cacheWorkspaceId: "ws-1",
    });
    usePageStore.setState({
      pages: {
        "current-row": {
          id: "current-row",
          workspaceId: "ws-1",
          title: "현재 행",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 1,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "current-db",
          dbCells: { "source-row-link": ["source-row"] },
        },
        "source-row": {
          id: "source-row",
          workspaceId: "ws-1",
          title: "소스 행",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 2,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "source-db",
          dbCells: { "source-text-with-page-id": ["linked-page-id"] },
        },
        "linked-page-id": {
          id: "linked-page-id",
          workspaceId: "ws-1",
          title: "연결된 작업",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 3,
          createdAt: 1,
          updatedAt: 1,
          dbCells: {},
        },
      },
      activePageId: null,
    });

    render(<DatabaseCellDisplay column={mirroredColumn} value={null} rowId="current-row" />);

    expect(screen.queryByText("연결된 작업")).not.toBeNull();
    expect(screen.queryByText("linked-page-id")).toBeNull();
  });

  it("일반 표시 컬럼 값이 page ID 배열이면 원본 ID 대신 페이지 제목을 표시한다", () => {
    const column: ColumnDef = {
      id: "linked-text",
      name: "연관작업",
      type: "text",
    };

    usePageStore.setState({
      pages: {
        "linked-page-id": {
          id: "linked-page-id",
          workspaceId: "ws-1",
          title: "연결된 작업",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 1,
          createdAt: 1,
          updatedAt: 1,
          dbCells: {},
        },
      },
      activePageId: null,
    });

    render(<DatabaseCellDisplay column={column} value={["linked-page-id"]} />);

    expect(screen.queryByText("연결된 작업")).not.toBeNull();
    expect(screen.queryByText("linked-page-id")).toBeNull();
  });

  it("person 값은 구성원 ID 대신 이름을 표시한다", () => {
    const memberId = "5c3609fc-e169-445b-a6ae-c74154d50b46";
    const column: ColumnDef = {
      id: "assignee",
      name: "담당자",
      type: "person",
    };

    useMemberStore.setState({
      members: [
        {
          memberId,
          email: "member@example.com",
          name: "홍길동",
          jobRole: "개발",
          workspaceRole: "member",
          status: "active",
          personalWorkspaceId: "ws-personal",
        },
      ],
      cacheWorkspaceId: "ws-1",
    });

    render(<DatabaseCellDisplay column={column} value={[memberId]} />);

    expect(screen.queryByText("홍길동")).not.toBeNull();
    expect(screen.queryByText(memberId)).toBeNull();
  });

  it("sourceFromDb 자동화 결과가 비어 있으면 저장된 선택값을 표시한다", () => {
    setupAutomatedSelectFixture("");

    render(
      <DatabaseCellDisplay
        column={automatedSelectColumn}
        value="manual-option"
        rowId="current-row"
      />,
    );

    expect(screen.queryByText("수동 선택")).not.toBeNull();
  });

  it("sourceFromDb 자동화 원본 행을 찾지 못하면 저장된 선택값을 표시한다", () => {
    setupAutomatedSelectFixture("", originalUpdateCell, {
      includeSourceRow: false,
      sourceLinkValue: [],
    });

    render(
      <DatabaseCellDisplay
        column={automatedSelectColumn}
        value="manual-option"
        rowId="current-row"
      />,
    );

    expect(screen.queryByText("수동 선택")).not.toBeNull();
  });

  it("sourceFromDb 자동화 결과가 나중에 생기면 저장된 선택값보다 자동화 값을 표시한다", async () => {
    setupAutomatedSelectFixture("");

    render(
      <DatabaseCellDisplay
        column={automatedSelectColumn}
        value="manual-option"
        rowId="current-row"
      />,
    );

    expect(screen.queryByText("수동 선택")).not.toBeNull();

    act(() => {
      usePageStore.setState((state) => {
        const sourceRow = state.pages["source-row"];
        if (!sourceRow) return { pages: state.pages };
        return {
          pages: {
            ...state.pages,
            "source-row": {
              ...sourceRow,
              dbCells: {
                ...sourceRow.dbCells,
                "source-priority": "auto-option",
              },
            },
          },
        };
      });
    });

    await waitFor(() => {
      expect(screen.queryByText("자동 선택")).not.toBeNull();
      expect(screen.queryByText("수동 선택")).toBeNull();
    });
  });

  it("sourceFromDb 자동화 결과가 비어 있으면 선택 셀을 직접 저장할 수 있다", () => {
    const updateCell = vi.fn();
    setupAutomatedSelectFixture([], updateCell);

    render(
      <DatabaseCell
        databaseId="current-db"
        rowId="current-row"
        column={automatedSelectColumn}
        value="manual-option"
      />,
    );

    fireEvent.click(screen.getByTitle("옵션 선택"));
    fireEvent.click(screen.getByText("자동 선택"));

    expect(updateCell).toHaveBeenCalledWith(
      "current-db",
      "current-row",
      "priority",
      "auto-option",
    );
  });

  it("sourceFromDb 자동화 결과가 비어 있으면 처리 행 rerender 뒤에도 직접 선택값을 유지한다", async () => {
    setupAutomatedSelectFixture("", originalUpdateCell, { manualValue: null });

    render(<ProcessedSelectCellProbe />);

    fireEvent.click(screen.getByTitle("옵션 선택"));
    fireEvent.click(screen.getByText("자동 선택"));

    await waitFor(() => {
      expect(screen.getByTitle("옵션 선택").textContent).toContain("자동 선택");
    });
    expect(usePageStore.getState().pages["current-row"]?.dbCells?.priority).toBe("auto-option");
  });
});
