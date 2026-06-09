import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyPanelState, type DatabasePanelState } from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useMemberStore } from "../../../store/memberStore";
import { usePageStore } from "../../../store/pageStore";
import { useProcessedRows } from "../useProcessedRows";

function RowsProbe({ panelState, cellId }: { panelState: DatabasePanelState; cellId?: string }) {
  const { rows } = useProcessedRows("db-1", panelState);
  return (
    <div>
      <output aria-label="row-count">{rows.length}</output>
      {cellId
        ? rows.map((row) => (
            <output key={`${row.pageId}:${cellId}`} aria-label={`cell-${row.pageId}`}>
              {String(row.cells[cellId] ?? "")}
            </output>
          ))
        : null}
      <ul>
        {rows.map((row) => (
          <li key={row.pageId}>{row.title}</li>
        ))}
      </ul>
    </div>
  );
}

describe("useProcessedRows", () => {
  beforeEach(() => {
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
    useDatabaseStore.setState({
      databases: {},
      cacheWorkspaceId: null,
    });
  });

  it("사람 속성은 구성원 이름 직접 입력으로 필터링된다", () => {
    const memberId = "c127410b-b345-4303-9a16-68442c20f902";
    useMemberStore.setState({
      members: [
        {
          memberId,
          email: "choi@example.com",
          name: "최진핑",
          jobRole: "작업자",
          workspaceRole: "member",
          status: "active",
          personalWorkspaceId: "ws-personal",
        },
      ],
      cacheWorkspaceId: "ws-1",
    });
    useDatabaseStore.setState({
      databases: {
        "db-1": {
          meta: {
            id: "db-1",
            title: "테스트 DB",
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [
            { id: "title", name: "이름", type: "title" },
            { id: "assignee", name: "작업자", type: "person" },
          ],
          rowPageOrder: ["pg-1", "pg-2"],
        },
      },
    });
    usePageStore.setState({
      pages: {
        "pg-1": {
          id: "pg-1",
          workspaceId: "ws-1",
          title: "업무 1",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 1,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "db-1",
          dbCells: { assignee: [memberId] },
        },
        "pg-2": {
          id: "pg-2",
          workspaceId: "ws-1",
          title: "업무 2",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 2,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "db-1",
          dbCells: { assignee: [] },
        },
      },
      activePageId: null,
    });
    const panelState: DatabasePanelState = {
      ...emptyPanelState(),
      filterRules: [
        {
          id: "filter-1",
          columnId: "assignee",
          operator: "contains",
          value: "최진핑",
        },
      ],
    };

    render(<RowsProbe panelState={panelState} />);

    expect(screen.getByLabelText("row-count").textContent).toBe("1");
    expect(screen.queryByText("업무 1")).not.toBeNull();
    expect(screen.queryByText("업무 2")).toBeNull();
  });

  it("선택 속성은 옵션 라벨 직접 입력으로 필터링된다", () => {
    useDatabaseStore.setState({
      databases: {
        "db-1": {
          meta: {
            id: "db-1",
            title: "테스트 DB",
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [
            { id: "title", name: "이름", type: "title" },
            {
              id: "status",
              name: "상태",
              type: "select",
              config: {
                options: [{ id: "opt-1", label: "진행중" }],
              },
            },
          ],
          rowPageOrder: ["pg-1", "pg-2"],
        },
      },
    });
    usePageStore.setState({
      pages: {
        "pg-1": {
          id: "pg-1",
          workspaceId: "ws-1",
          title: "업무 1",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 1,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "db-1",
          dbCells: { status: "opt-1" },
        },
        "pg-2": {
          id: "pg-2",
          workspaceId: "ws-1",
          title: "업무 2",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 2,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "db-1",
          dbCells: { status: null },
        },
      },
      activePageId: null,
    });
    const panelState: DatabasePanelState = {
      ...emptyPanelState(),
      filterRules: [
        {
          id: "filter-1",
          columnId: "status",
          operator: "contains",
          value: "진행",
        },
      ],
    };

    render(<RowsProbe panelState={panelState} />);

    expect(screen.getByLabelText("row-count").textContent).toBe("1");
    expect(screen.queryByText("업무 1")).not.toBeNull();
    expect(screen.queryByText("업무 2")).toBeNull();
  });

  it("DB 연결 속성은 DB 제목 직접 입력으로 필터링된다", () => {
    useDatabaseStore.setState({
      databases: {
        "db-1": {
          meta: {
            id: "db-1",
            title: "테스트 DB",
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [
            { id: "title", name: "이름", type: "title" },
            { id: "relatedDb", name: "관련 DB", type: "dbLink" },
          ],
          rowPageOrder: ["pg-1", "pg-2"],
        },
        "linked-db": {
          meta: {
            id: "linked-db",
            title: "참조 프로젝트",
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [{ id: "title", name: "이름", type: "title" }],
          rowPageOrder: [],
        },
      },
    });
    usePageStore.setState({
      pages: {
        "pg-1": {
          id: "pg-1",
          workspaceId: "ws-1",
          title: "업무 1",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 1,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "db-1",
          dbCells: { relatedDb: "linked-db" },
        },
        "pg-2": {
          id: "pg-2",
          workspaceId: "ws-1",
          title: "업무 2",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 2,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "db-1",
          dbCells: { relatedDb: null },
        },
      },
      activePageId: null,
    });
    const panelState: DatabasePanelState = {
      ...emptyPanelState(),
      filterRules: [
        {
          id: "filter-1",
          columnId: "relatedDb",
          operator: "contains",
          value: "참조 프로젝트",
        },
      ],
    };

    render(<RowsProbe panelState={panelState} />);

    expect(screen.getByLabelText("row-count").textContent).toBe("1");
    expect(screen.queryByText("업무 1")).not.toBeNull();
    expect(screen.queryByText("업무 2")).toBeNull();
  });

  it("페이지 연결 속성은 연결된 페이지 제목 직접 입력으로 필터링된다", () => {
    useDatabaseStore.setState({
      databases: {
        "db-1": {
          meta: {
            id: "db-1",
            title: "테스트 DB",
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [
            { id: "title", name: "이름", type: "title" },
            { id: "relatedPage", name: "관련 페이지", type: "pageLink" },
          ],
          rowPageOrder: ["pg-1", "pg-2"],
        },
      },
    });
    usePageStore.setState({
      pages: {
        "pg-1": {
          id: "pg-1",
          workspaceId: "ws-1",
          title: "업무 1",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 1,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "db-1",
          dbCells: { relatedPage: ["linked-page"] },
        },
        "pg-2": {
          id: "pg-2",
          workspaceId: "ws-1",
          title: "업무 2",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 2,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "db-1",
          dbCells: { relatedPage: [] },
        },
        "linked-page": {
          id: "linked-page",
          workspaceId: "ws-1",
          title: "연결된 기획서",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 3,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      activePageId: null,
    });
    const panelState: DatabasePanelState = {
      ...emptyPanelState(),
      filterRules: [
        {
          id: "filter-1",
          columnId: "relatedPage",
          operator: "contains",
          value: "연결된 기획서",
        },
      ],
    };

    render(<RowsProbe panelState={panelState} />);

    expect(screen.getByLabelText("row-count").textContent).toBe("1");
    expect(screen.queryByText("업무 1")).not.toBeNull();
    expect(screen.queryByText("업무 2")).toBeNull();
  });

  it("sourceFromDb 자동화 결과가 비어 있으면 수동 선택값을 row 값으로 유지한다", () => {
    useDatabaseStore.setState({
      databases: {
        "db-1": {
          meta: {
            id: "db-1",
            title: "작업 DB",
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [
            { id: "title", name: "이름", type: "title" },
            {
              id: "feature",
              name: "피처",
              type: "pageLink",
              config: { pageLinkScopeDatabaseId: "feature-db" },
            },
            {
              id: "priority",
              name: "우선순위",
              type: "select",
              config: {
                sourceFromDb: {
                  databaseId: "feature-db",
                  columnId: "source-priority",
                  automation: true,
                },
              },
            },
          ],
          rowPageOrder: ["task-1"],
        },
        "feature-db": {
          meta: {
            id: "feature-db",
            title: "피처 DB",
            createdAt: 1,
            updatedAt: 1,
          },
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
          rowPageOrder: ["feature-1"],
        },
      },
    });
    usePageStore.setState({
      pages: {
        "task-1": {
          id: "task-1",
          workspaceId: "ws-1",
          title: "작업 1",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 1,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "db-1",
          dbCells: { feature: ["feature-1"], priority: "manual-option" },
        },
        "feature-1": {
          id: "feature-1",
          workspaceId: "ws-1",
          title: "피처 1",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 2,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "feature-db",
          dbCells: { "source-priority": "" },
        },
      },
      activePageId: null,
    });

    render(<RowsProbe panelState={emptyPanelState()} cellId="priority" />);

    expect(screen.getByLabelText("cell-task-1").textContent).toBe("manual-option");
  });
});
