import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPanelState, type CellValue, type ColumnDef, type DatabasePanelState } from "../../../../types/database";
import { useDatabaseStore } from "../../../../store/databaseStore";
import { useMemberStore } from "../../../../store/memberStore";
import { usePageStore } from "../../../../store/pageStore";
import { COLOR_PRESETS } from "../../../../lib/scheduler/colors";
import { TIMELINE_CARD_COLOR_OVERRIDES_CELL_ID } from "../../../../lib/database/timelineCardColor";
import { DatabaseTimelineView } from "../DatabaseTimelineView";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const titleColumn: ColumnDef = { id: "title", name: "이름", type: "title" };
const dateColumn: ColumnDef = { id: "period", name: "기간", type: "date" };

function seedTimelineDatabase(extraColumns: ColumnDef[], cells: Record<string, CellValue>) {
  useDatabaseStore.setState({
    databases: {
      "db-1": {
        meta: { id: "db-1", title: "작업 DB", createdAt: 1, updatedAt: 1 },
        columns: [titleColumn, dateColumn, ...extraColumns],
        rowPageOrder: ["task-1"],
      },
    },
    cacheWorkspaceId: "ws-1",
  });
  usePageStore.setState({
    pages: {
      "task-1": {
        id: "task-1",
        workspaceId: "ws-1",
        title: "작업 카드",
        icon: null,
        doc: { type: "doc", content: [] },
        parentId: null,
        order: 1,
        createdAt: 1,
        updatedAt: 1,
        databaseId: "db-1",
        dbCells: {
          period: { start: "2026-05-07", end: "2026-05-11" },
          ...cells,
        },
      },
    },
    activePageId: null,
  });
}

function seedTimelineDatabaseRows(
  extraColumns: ColumnDef[],
  rows: Array<{ id: string; title: string; cells: Record<string, CellValue> }>,
) {
  useDatabaseStore.setState({
    databases: {
      "db-1": {
        meta: { id: "db-1", title: "Task DB", createdAt: 1, updatedAt: 1 },
        columns: [titleColumn, dateColumn, ...extraColumns],
        rowPageOrder: rows.map((row) => row.id),
      },
    },
    cacheWorkspaceId: "ws-1",
  });
  usePageStore.setState({
    pages: Object.fromEntries(
      rows.map((row, index) => [
        row.id,
        {
          id: row.id,
          workspaceId: "ws-1",
          title: row.title,
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: index + 1,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "db-1",
          dbCells: {
            period: { start: "2026-05-07", end: "2026-05-11" },
            ...row.cells,
          },
        },
      ]),
    ),
    activePageId: null,
  });
}

function renderTimeline(panelState: DatabasePanelState) {
  return render(
    <DatabaseTimelineView
      databaseId="db-1"
      panelState={panelState}
      setPanelState={vi.fn()}
    />,
  );
}

describe("DatabaseTimelineView 카드 표시 속성", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    localStorage.clear();
    useDatabaseStore.setState({ databases: {}, cacheWorkspaceId: null });
    usePageStore.setState({ pages: {}, activePageId: null });
    useMemberStore.setState({
      members: [],
      cacheWorkspaceId: null,
      lastFetchedAt: null,
      mentionCandidates: [],
      mentionQuery: "",
    });
  });

  it("타임라인 표시 설정에서 날짜 컬럼을 숨기면 카드 날짜 텍스트를 표시하지 않는다", () => {
    const memberId = "5c3609fc-e169-445b-a6ae-c74154d50b46";
    seedTimelineDatabase(
      [{ id: "assignee", name: "담당자", type: "person" }],
      { assignee: [memberId] },
    );
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
    const panelState: DatabasePanelState = {
      ...emptyPanelState(),
      timelineDateColumnId: "period",
      viewConfigs: {
        timeline: { visibleColumnIds: ["title", "assignee"] },
      },
    };

    renderTimeline(panelState);

    expect(screen.queryByText("5/7 ~ 5/11")).toBeNull();
    expect(screen.queryByText("홍길동")).not.toBeNull();
    expect(screen.queryByText(memberId)).toBeNull();
  });

  it("새 표시 설정 형식에서도 숨김 처리한 날짜 컬럼은 카드 날짜 텍스트를 표시하지 않는다", () => {
    seedTimelineDatabase(
      [{ id: "assignee", name: "담당자", type: "text" }],
      { assignee: "홍길동" },
    );
    const panelState: DatabasePanelState = {
      ...emptyPanelState(),
      timelineDateColumnId: "period",
      viewConfigs: {
        timeline: {
          visibleColumnIds: ["title", "period", "assignee"],
          hiddenColumnIds: ["period"],
        },
      },
    };

    renderTimeline(panelState);

    expect(screen.queryByText("5/7 ~ 5/11")).toBeNull();
    expect(screen.queryByText("홍길동")).not.toBeNull();
  });

  it("hiddenColumnIds만 있는 타임라인 표시 설정도 카드 보조 속성에 적용한다", () => {
    seedTimelineDatabase(
      [{ id: "assignee", name: "Assignee", type: "text" }],
      { assignee: "hidden-value" },
    );
    const panelState: DatabasePanelState = {
      ...emptyPanelState(),
      timelineDateColumnId: "period",
      viewConfigs: {
        timeline: {
          hiddenColumnIds: ["assignee"],
        },
      },
    };

    renderTimeline(panelState);

    expect(screen.queryByText("hidden-value")).toBeNull();
  });

  it("primary 날짜 컬럼의 카드 표시를 끄면 fallback 카드도 만들지 않는다", () => {
    useDatabaseStore.setState({
      databases: {
        "db-1": {
          meta: { id: "db-1", title: "작업 DB", createdAt: 1, updatedAt: 1 },
          columns: [
            titleColumn,
            {
              ...dateColumn,
              config: { timelineCard: { enabled: false } },
            },
          ],
          rowPageOrder: ["task-1"],
        },
      },
      cacheWorkspaceId: "ws-1",
    });
    usePageStore.setState({
      pages: {
        "task-1": {
          id: "task-1",
          workspaceId: "ws-1",
          title: "작업 카드",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 1,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "db-1",
          dbCells: {
            period: { start: "2026-05-07", end: "2026-05-11" },
          },
        },
      },
      activePageId: null,
    });
    const panelState: DatabasePanelState = {
      ...emptyPanelState(),
      timelineDateColumnId: "period",
    };

    const { container } = renderTimeline(panelState);

    expect(container.querySelector("[data-db-timeline-card='true']")).toBeNull();
  });

  it("표시 값이 없는 속성은 카드에 점 separator만 남기지 않는다", () => {
    seedTimelineDatabase(
      [
        { id: "empty-fetch-1", name: "빈 가져오기 1", type: "itemFetch" },
        { id: "empty-fetch-2", name: "빈 가져오기 2", type: "itemFetch" },
      ],
      {},
    );
    const panelState: DatabasePanelState = {
      ...emptyPanelState(),
      timelineDateColumnId: "period",
      viewConfigs: {
        timeline: { visibleColumnIds: ["title", "empty-fetch-1", "empty-fetch-2"] },
      },
    };

    renderTimeline(panelState);

    expect(screen.queryByText("·")).toBeNull();
  });

  it("타임라인 카드를 우클릭하면 컬러 프리셋 메뉴로 카드 색상을 바꾼다", () => {
    seedTimelineDatabaseRows([], [
      { id: "task-1", title: "Task card 1", cells: {} },
      { id: "task-2", title: "Task card 2", cells: {} },
    ]);
    const panelState: DatabasePanelState = {
      ...emptyPanelState(),
      timelineDateColumnId: "period",
    };

    const { container } = renderTimeline(panelState);

    const cardElement = container.querySelector("[data-db-timeline-card-page='task-1']");
    expect(cardElement).not.toBeNull();

    const event = createEvent.mouseDown(cardElement as HTMLElement, {
      button: 2,
      clientX: 90,
      clientY: 110,
    });
    fireEvent(cardElement as HTMLElement, event);

    expect(event.defaultPrevented).toBe(true);
    const contextMenuEvent = createEvent.contextMenu(cardElement as HTMLElement, {
      clientX: 90,
      clientY: 110,
    });
    fireEvent(cardElement as HTMLElement, contextMenuEvent);
    expect(contextMenuEvent.defaultPrevented).toBe(true);

    const nextColor = COLOR_PRESETS[0];
    fireEvent.click(screen.getByTitle(nextColor));

    const pages = usePageStore.getState().pages;
    expect(pages["task-1"]?.dbCells?.[TIMELINE_CARD_COLOR_OVERRIDES_CELL_ID]).toEqual({
      period: nextColor,
    });
    expect(pages["task-2"]?.dbCells?.[TIMELINE_CARD_COLOR_OVERRIDES_CELL_ID]).toBeUndefined();
    const column = useDatabaseStore
      .getState()
      .databases["db-1"]
      ?.columns.find((candidate) => candidate.id === "period");
    expect(column?.config?.timelineCard?.color).toBeUndefined();
  });
});
