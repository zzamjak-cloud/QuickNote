import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import type { DatabasePanelState } from "../../../types/database";
import { emptyPanelState } from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useWorkspaceStore } from "../../../store/workspaceStore";
import { DatabaseToolbarControls } from "../DatabaseToolbarControls";

const dndMockState = vi.hoisted(() => ({
  onDragEnd: null as null | ((event: { active: { id: string }; over: { id: string } | null }) => void),
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, onDragEnd }: { children: ReactNode; onDragEnd: typeof dndMockState.onDragEnd }) => {
    dndMockState.onDragEnd = onDragEnd;
    return <div data-testid="preset-dnd-context">{children}</div>;
  },
  closestCenter: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: vi.fn((sensor, options) => ({ sensor, options })),
  useSensors: vi.fn((...sensors) => sensors),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: ReactNode }) => (
    <div data-testid="preset-sortable-context">{children}</div>
  ),
  arrayMove: <T,>(items: T[], oldIndex: number, newIndex: number) => {
    const next = [...items];
    const [removed] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, removed);
    return next;
  },
  rectSortingStrategy: vi.fn(),
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

let latestPanelState: DatabasePanelState | null = null;

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

function ToolbarHarness() {
  const [panelState, setPanelStateRaw] = useState<DatabasePanelState>(() => ({
    ...emptyPanelState(),
    activePresetId: "preset-2",
    filterPresets: [
      { id: "preset-1", name: "탭 1", filterRules: [], sortRules: [] },
      { id: "preset-2", name: "탭 2", filterRules: [], sortRules: [] },
      { id: "preset-3", name: "탭 3", filterRules: [], sortRules: [] },
    ],
  }));
  latestPanelState = panelState;

  const setPanelState = (patch: Partial<DatabasePanelState>) => {
    setPanelStateRaw((prev) => ({ ...prev, ...patch }));
  };

  return (
    <DatabaseToolbarControls
      databaseId="db-1"
      viewKind="table"
      view="table"
      onViewChange={() => {}}
      panelState={panelState}
      setPanelState={setPanelState}
      layout="fullPage"
    />
  );
}

describe("DatabaseToolbarControls preset tab drag and drop", () => {
  beforeEach(() => {
    dndMockState.onDragEnd = null;
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    useWorkspaceStore.setState({
      currentWorkspaceId: null,
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
          columns: [{ id: "title", name: "이름", type: "title" }],
          rowPageOrder: [],
        },
      },
    });
  });

  it("드래그 종료 시 프리셋 탭 순서를 변경하고 활성 탭은 유지한다", () => {
    render(<ToolbarHarness />);

    expect(screen.getByTestId("preset-dnd-context")).toBeInTheDocument();
    expect(latestPanelState?.filterPresets?.map((preset) => preset.id)).toEqual([
      "preset-1",
      "preset-2",
      "preset-3",
    ]);

    act(() => {
      dndMockState.onDragEnd?.({
        active: { id: "preset-1" },
        over: { id: "preset-3" },
      });
    });

    expect(latestPanelState?.filterPresets?.map((preset) => preset.id)).toEqual([
      "preset-2",
      "preset-3",
      "preset-1",
    ]);
    expect(latestPanelState?.activePresetId).toBe("preset-2");
  });
});
