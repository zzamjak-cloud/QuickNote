import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { emptyPanelState, type DatabasePanelState } from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { usePageStore } from "../../../store/pageStore";
import { useSchedulerViewStore } from "../../../store/schedulerViewStore";
import { LC_FEATURE_COLUMN_IDS, makeLCFeatureDatabaseId } from "../../../lib/scheduler/featureDatabase";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../../lib/scheduler/scope";
import { SchedulerDatabaseTimeline } from "../SchedulerDatabaseTimeline";

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

function seedFeatureTimeline(panelState: DatabasePanelState) {
  const databaseId = makeLCFeatureDatabaseId(LC_SCHEDULER_WORKSPACE_ID);
  useDatabaseStore.setState({
    databases: {
      [databaseId]: {
        meta: {
          id: databaseId,
          workspaceId: LC_SCHEDULER_WORKSPACE_ID,
          title: "피처",
          createdAt: 1,
          updatedAt: 1,
        },
        columns: [
          { id: LC_FEATURE_COLUMN_IDS.title, name: "피처", type: "title" },
          { id: LC_FEATURE_COLUMN_IDS.workStart, name: "작업 기간", type: "date" },
          { id: "owner", name: "담당", type: "text" },
        ],
        panelState,
        rowPageOrder: ["feature-1"],
      },
    },
    cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
  });
  usePageStore.setState({
    pages: {
      "feature-1": {
        id: "feature-1",
        workspaceId: LC_SCHEDULER_WORKSPACE_ID,
        title: "피처 카드",
        icon: null,
        doc: { type: "doc", content: [] },
        parentId: null,
        order: 1,
        createdAt: 1,
        updatedAt: 1,
        databaseId,
        dbCells: {
          [LC_FEATURE_COLUMN_IDS.workStart]: { start: "2026-05-07", end: "2026-05-11" },
          owner: "홍길동",
        },
      },
    },
    activePageId: null,
    cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
  });
}

describe("SchedulerDatabaseTimeline 카드 표시 속성", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    localStorage.clear();
    useDatabaseStore.setState({ databases: {}, cacheWorkspaceId: null });
    usePageStore.setState({ pages: {}, activePageId: null, cacheWorkspaceId: null });
    useSchedulerViewStore.setState({
      viewMode: "year",
      currentYear: 2026,
      selectedProjectId: null,
      zoomLevel: 1,
      columnWidthScale: 1,
      databaseTimelineItemColumnWidth: 220,
    });
  });

  it("피처 DB 카드도 타임라인 표시 설정의 표시 컬럼을 보조 정보로 사용한다", () => {
    seedFeatureTimeline({
      ...emptyPanelState(),
      viewConfigs: {
        timeline: { visibleColumnIds: [LC_FEATURE_COLUMN_IDS.title, LC_FEATURE_COLUMN_IDS.workStart, "owner"] },
      },
    });

    render(<SchedulerDatabaseTimeline mode="feature" workspaceId={LC_SCHEDULER_WORKSPACE_ID} />);

    expect(screen.queryByText("5/7 ~ 5/11")).not.toBeNull();
    expect(screen.queryByText("홍길동")).not.toBeNull();
  });

  it("피처 DB 카드도 hiddenColumnIds에 날짜 컬럼이 있으면 기간 텍스트를 숨긴다", () => {
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
    expect(screen.queryByText("홍길동")).not.toBeNull();
  });
});
