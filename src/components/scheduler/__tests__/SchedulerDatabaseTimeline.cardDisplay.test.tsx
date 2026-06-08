import { createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { emptyPanelState, type DatabasePanelState } from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useDatabaseRowIndexStore } from "../../../store/databaseRowIndexStore";
import { usePageStore } from "../../../store/pageStore";
import { useSchedulerViewStore } from "../../../store/schedulerViewStore";
import { useUiStore } from "../../../store/uiStore";
import { LC_FEATURE_COLUMN_IDS, makeLCFeatureDatabaseId } from "../../../lib/scheduler/featureDatabase";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../../lib/scheduler/scope";
import { COLOR_PRESETS } from "../../../lib/scheduler/colors";
import { TIMELINE_CARD_COLOR_OVERRIDES_CELL_ID } from "../../../lib/database/timelineCardColor";
import { SchedulerDatabaseTimeline } from "../SchedulerDatabaseTimeline";

const pageContentMocks = vi.hoisted(() => ({
  ensurePageContentLoaded: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("../../../lib/sync/pageContentLoad", () => ({
  ensurePageContentLoaded: pageContentMocks.ensurePageContentLoaded,
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  closestCenter: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: vi.fn((sensor, options) => ({ sensor, options })),
  useSensors: vi.fn((...sensors) => sensors),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  arrayMove: <T,>(items: T[], oldIndex: number, newIndex: number) => {
    const next = [...items];
    const [removed] = next.splice(oldIndex, 1);
    if (removed) next.splice(newIndex, 0, removed);
    return next;
  },
  verticalListSortingStrategy: vi.fn(),
  useSortable: ({ id }: { id: string }) => ({
    attributes: { "data-sortable-id": id },
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Transform: {
      toString: vi.fn(() => ""),
    },
  },
}));

function seedFeatureTimeline(
  panelState: DatabasePanelState,
  rows: Array<{ id: string; title: string; owner: string }> = [
    { id: "feature-1", title: "Feature card", owner: "Member 1" },
  ],
) {
  const databaseId = makeLCFeatureDatabaseId(LC_SCHEDULER_WORKSPACE_ID);
  useDatabaseStore.setState({
    databases: {
      [databaseId]: {
        meta: {
          id: databaseId,
          workspaceId: LC_SCHEDULER_WORKSPACE_ID,
          title: "Features",
          createdAt: 1,
          updatedAt: 1,
        },
        columns: [
          { id: LC_FEATURE_COLUMN_IDS.title, name: "Feature", type: "title" },
          { id: LC_FEATURE_COLUMN_IDS.workStart, name: "Work period", type: "date" },
          { id: "owner", name: "Owner", type: "text" },
        ],
        panelState,
        rowPageOrder: rows.map((row) => row.id),
      },
    },
    cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
  });
  usePageStore.setState({
    pages: Object.fromEntries(
      rows.map((row, index) => [
        row.id,
        {
          id: row.id,
          workspaceId: LC_SCHEDULER_WORKSPACE_ID,
          title: row.title,
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: index + 1,
          createdAt: 1,
          updatedAt: 1,
          databaseId,
          dbCells: {
            [LC_FEATURE_COLUMN_IDS.workStart]: { start: "2026-05-07", end: "2026-05-11" },
            owner: row.owner,
          },
        },
      ]),
    ),
    activePageId: null,
    cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
  });
}

describe("SchedulerDatabaseTimeline card display properties", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    localStorage.clear();
    useDatabaseStore.setState({ databases: {}, cacheWorkspaceId: null });
    useDatabaseRowIndexStore.setState({
      snapshotsByKey: {},
      hydratedByKey: {},
      loadingByKey: {},
    });
    usePageStore.setState({ pages: {}, activePageId: null, cacheWorkspaceId: null });
    useUiStore.setState({ peekPageId: null, peekHistory: [], toasts: [] });
    pageContentMocks.ensurePageContentLoaded.mockClear();
    pageContentMocks.ensurePageContentLoaded.mockResolvedValue(true);
    useSchedulerViewStore.setState({
      viewMode: "year",
      currentYear: 2026,
      selectedProjectId: null,
      zoomLevel: 1,
      columnWidthScale: 1,
      databaseTimelineItemColumnWidth: 220,
    });
  });

  it("uses timeline display settings as supplementary card info", () => {
    seedFeatureTimeline({
      ...emptyPanelState(),
      viewConfigs: {
        timeline: { visibleColumnIds: [LC_FEATURE_COLUMN_IDS.title, LC_FEATURE_COLUMN_IDS.workStart, "owner"] },
      },
    });

    render(<SchedulerDatabaseTimeline mode="feature" workspaceId={LC_SCHEDULER_WORKSPACE_ID} />);

    expect(screen.queryByText("5/7 ~ 5/11")).not.toBeNull();
    expect(screen.queryByText("Member 1")).not.toBeNull();
  });

  it("hides the date label when the date column is hidden", () => {
    seedFeatureTimeline({
      ...emptyPanelState(),
      viewConfigs: {
        timeline: {
          visibleColumnIds: [LC_FEATURE_COLUMN_IDS.title, LC_FEATURE_COLUMN_IDS.workStart, "owner"],
          hiddenColumnIds: [LC_FEATURE_COLUMN_IDS.workStart],
        },
      },
    });

    render(<SchedulerDatabaseTimeline mode="feature" workspaceId={LC_SCHEDULER_WORKSPACE_ID} />);

    expect(screen.queryByText("5/7 ~ 5/11")).toBeNull();
    expect(screen.queryByText("Member 1")).not.toBeNull();
  });

  it("changes only the selected timeline card color from the context menu", async () => {
    const databaseId = makeLCFeatureDatabaseId(LC_SCHEDULER_WORKSPACE_ID);
    seedFeatureTimeline(
      {
        ...emptyPanelState(),
        timelineDateColumnId: LC_FEATURE_COLUMN_IDS.workStart,
      },
      [
        { id: "feature-1", title: "Feature card", owner: "Member 1" },
        { id: "feature-2", title: "Feature card 2", owner: "Member 2" },
      ],
    );

    render(<SchedulerDatabaseTimeline mode="feature" workspaceId={LC_SCHEDULER_WORKSPACE_ID} />);

    const cardTitle = screen
      .getAllByText("Feature card")
      .find((element) => element.closest(".cursor-grab"));
    expect(cardTitle).toBeDefined();

    const cardElement = cardTitle!.closest(".cursor-grab") as HTMLElement;
    const event = createEvent.mouseDown(cardElement, {
      button: 2,
      clientX: 100,
      clientY: 120,
    });
    fireEvent(cardElement, event);

    expect(event.defaultPrevented).toBe(true);
    const cardWrapper = cardElement.closest("[data-scheduler-db-timeline-card='true']");
    expect(cardWrapper).not.toBeNull();
    const contextMenuEvent = createEvent.contextMenu(cardWrapper as HTMLElement, {
      clientX: 100,
      clientY: 120,
    });
    fireEvent(cardWrapper as HTMLElement, contextMenuEvent);
    expect(contextMenuEvent.defaultPrevented).toBe(true);

    const nextColor = COLOR_PRESETS[0];
    fireEvent.click(screen.getByTitle(nextColor));

    await waitFor(() => {
      const pages = usePageStore.getState().pages;
      expect(pages["feature-1"]?.dbCells?.[TIMELINE_CARD_COLOR_OVERRIDES_CELL_ID]).toEqual({
        [LC_FEATURE_COLUMN_IDS.workStart]: nextColor,
      });
      expect(pages["feature-2"]?.dbCells?.[TIMELINE_CARD_COLOR_OVERRIDES_CELL_ID]).toBeUndefined();
    });
    const column = useDatabaseStore
      .getState()
      .databases[databaseId]
      ?.columns.find((candidate) => candidate.id === LC_FEATURE_COLUMN_IDS.workStart);
    expect(column?.config?.timelineCard?.color).toBeUndefined();
  });

  it("renders cached row index entries before row pages are loaded", () => {
    const databaseId = makeLCFeatureDatabaseId(LC_SCHEDULER_WORKSPACE_ID);
    useDatabaseStore.setState({
      databases: {
        [databaseId]: {
          meta: {
            id: databaseId,
            workspaceId: LC_SCHEDULER_WORKSPACE_ID,
            title: "Features",
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [
            { id: LC_FEATURE_COLUMN_IDS.title, name: "Feature", type: "title" },
            { id: LC_FEATURE_COLUMN_IDS.workStart, name: "Work period", type: "date" },
            { id: "owner", name: "Owner", type: "text" },
          ],
          panelState: {
            ...emptyPanelState(),
            viewConfigs: {
              timeline: {
                visibleColumnIds: [LC_FEATURE_COLUMN_IDS.title, LC_FEATURE_COLUMN_IDS.workStart, "owner"],
              },
            },
          },
          rowPageOrder: [],
        },
      },
      cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
    });
    useDatabaseRowIndexStore.setState({
      snapshotsByKey: {
        [databaseId]: {
          v: 1,
          indexKey: databaseId,
          databaseId,
          complete: true,
          updatedAt: 1,
          rows: [
            {
              pageId: "feature-index-row",
              workspaceId: LC_SCHEDULER_WORKSPACE_ID,
              databaseId,
              title: "Feature card",
              icon: null,
              order: 1,
              dbCells: {
                [LC_FEATURE_COLUMN_IDS.workStart]: { start: "2026-05-07", end: "2026-05-11" },
                owner: "Member 1",
              },
              updatedAt: 1,
            },
          ],
        },
      },
      hydratedByKey: { [databaseId]: true },
      loadingByKey: {},
    });

    render(<SchedulerDatabaseTimeline mode="feature" workspaceId={LC_SCHEDULER_WORKSPACE_ID} />);

    expect(screen.getAllByText("Feature card").length).toBeGreaterThan(0);
    expect(screen.queryByText("Member 1")).not.toBeNull();
  });

  it("loads cached-only row content before opening a timeline card", async () => {
    const databaseId = makeLCFeatureDatabaseId(LC_SCHEDULER_WORKSPACE_ID);
    useDatabaseStore.setState({
      databases: {
        [databaseId]: {
          meta: {
            id: databaseId,
            workspaceId: LC_SCHEDULER_WORKSPACE_ID,
            title: "Features",
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [
            { id: LC_FEATURE_COLUMN_IDS.title, name: "Feature", type: "title" },
            { id: LC_FEATURE_COLUMN_IDS.workStart, name: "Work period", type: "date" },
          ],
          panelState: emptyPanelState(),
          rowPageOrder: [],
        },
      },
      cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
    });
    useDatabaseRowIndexStore.setState({
      snapshotsByKey: {
        [databaseId]: {
          v: 1,
          indexKey: databaseId,
          databaseId,
          complete: true,
          updatedAt: 1,
          rows: [
            {
              pageId: "feature-index-row",
              workspaceId: LC_SCHEDULER_WORKSPACE_ID,
              databaseId,
              title: "Feature card",
              icon: null,
              order: 1,
              dbCells: {
                [LC_FEATURE_COLUMN_IDS.workStart]: { start: "2026-05-07", end: "2026-05-11" },
              },
              updatedAt: 1,
            },
          ],
        },
      },
      hydratedByKey: { [databaseId]: true },
      loadingByKey: {},
    });

    render(<SchedulerDatabaseTimeline mode="feature" workspaceId={LC_SCHEDULER_WORKSPACE_ID} />);

    const cardTitle = screen
      .getAllByText("Feature card")
      .find((element) => element.closest(".cursor-grab"));
    expect(cardTitle).toBeDefined();
    fireEvent.doubleClick(cardTitle!.closest(".cursor-grab") as HTMLElement);

    await waitFor(() => {
      expect(pageContentMocks.ensurePageContentLoaded).toHaveBeenCalledWith({
        pageId: "feature-index-row",
        workspaceId: LC_SCHEDULER_WORKSPACE_ID,
        source: "lc-scheduler-timeline-open",
      });
      expect(useUiStore.getState().peekPageId).toBe("feature-index-row");
    });
  });

  it("keeps cached-only row closed when content loading fails", async () => {
    const databaseId = makeLCFeatureDatabaseId(LC_SCHEDULER_WORKSPACE_ID);
    pageContentMocks.ensurePageContentLoaded.mockResolvedValueOnce(false);
    useDatabaseStore.setState({
      databases: {
        [databaseId]: {
          meta: {
            id: databaseId,
            workspaceId: LC_SCHEDULER_WORKSPACE_ID,
            title: "Features",
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [
            { id: LC_FEATURE_COLUMN_IDS.title, name: "Feature", type: "title" },
            { id: LC_FEATURE_COLUMN_IDS.workStart, name: "Work period", type: "date" },
          ],
          panelState: emptyPanelState(),
          rowPageOrder: [],
        },
      },
      cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
    });
    useDatabaseRowIndexStore.setState({
      snapshotsByKey: {
        [databaseId]: {
          v: 1,
          indexKey: databaseId,
          databaseId,
          complete: true,
          updatedAt: 1,
          rows: [
            {
              pageId: "feature-index-row",
              workspaceId: LC_SCHEDULER_WORKSPACE_ID,
              databaseId,
              title: "Feature card",
              icon: null,
              order: 1,
              dbCells: {
                [LC_FEATURE_COLUMN_IDS.workStart]: { start: "2026-05-07", end: "2026-05-11" },
              },
              updatedAt: 1,
            },
          ],
        },
      },
      hydratedByKey: { [databaseId]: true },
      loadingByKey: {},
    });

    render(<SchedulerDatabaseTimeline mode="feature" workspaceId={LC_SCHEDULER_WORKSPACE_ID} />);

    const cardTitle = screen
      .getAllByText("Feature card")
      .find((element) => element.closest(".cursor-grab"));
    expect(cardTitle).toBeDefined();
    fireEvent.doubleClick(cardTitle!.closest(".cursor-grab") as HTMLElement);

    await waitFor(() => {
      expect(useUiStore.getState().peekPageId).toBeNull();
      expect(useUiStore.getState().toasts.some((toast) => toast.kind === "error")).toBe(true);
    });
  });
});
