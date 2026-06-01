import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useMemberStore, type Member } from "../../../store/memberStore";
import { useOrganizationStore } from "../../../store/organizationStore";
import { useSchedulerProjectsStore } from "../../../store/schedulerProjectsStore";
import { useSchedulerViewStore } from "../../../store/schedulerViewStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { useTeamStore } from "../../../store/teamStore";
import { LC_SCHEDULER_DATABASE_ID, LC_SCHEDULER_DATABASE_TITLE } from "../../../lib/scheduler/database";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../../lib/scheduler/scope";
import { SchedulerTeamTabs } from "../SchedulerTeamTabs";

vi.mock("../../../lib/sync/runtime", () => ({
  enqueueAsync: vi.fn(),
}));

const dndMockState = vi.hoisted(() => ({
  modifiers: undefined as undefined | Array<(args: { transform: { x: number; y: number; scaleX: number; scaleY: number } }) => { x: number; y: number; scaleX: number; scaleY: number }>,
  onDragEnd: undefined as undefined | ((event: { active: { id: string }; over: { id: string } | null }) => void),
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({
    children,
    modifiers,
    onDragEnd,
  }: {
    children: ReactNode;
    modifiers?: typeof dndMockState.modifiers;
    onDragEnd?: typeof dndMockState.onDragEnd;
  }) => {
    dndMockState.modifiers = modifiers;
    dndMockState.onDragEnd = onDragEnd;
    return <div data-testid="member-dnd-context">{children}</div>;
  },
  closestCenter: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: vi.fn((sensor, options) => ({ sensor, options })),
  useSensors: vi.fn((...sensors) => sensors),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: ReactNode }) => (
    <div data-testid="member-sortable-context">{children}</div>
  ),
  arrayMove: <T,>(items: T[], oldIndex: number, newIndex: number) => {
    const next = [...items];
    const [removed] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, removed);
    return next;
  },
  horizontalListSortingStrategy: vi.fn(),
  useSortable: ({ id }: { id: string }) => ({
    attributes: { "data-sortable-id": id },
    listeners: { onPointerDown: vi.fn() },
    setNodeRef: vi.fn(),
    transform: { x: 12, y: 8, scaleX: 1, scaleY: 1 },
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

function member(memberId: string, name: string): Member {
  return {
    memberId,
    email: `${memberId}@example.com`,
    name,
    jobRole: "작업",
    workspaceRole: "member",
    status: "active",
    personalWorkspaceId: `${memberId}-workspace`,
    cognitoSub: memberId,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("SchedulerTeamTabs", () => {
  beforeEach(() => {
    dndMockState.modifiers = undefined;
    dndMockState.onDragEnd = undefined;
    useMemberStore.setState({
      members: [
        member("member-1", "가람"),
        member("member-2", "나래"),
      ],
      cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
      lastFetchedAt: null,
      mentionCandidates: [],
      mentionQuery: "",
    });
    useOrganizationStore.setState({ organizations: [], cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID });
    useTeamStore.setState({ teams: [], cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID });
    useSchedulerProjectsStore.setState({ projects: [], cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID });
    useSchedulerViewStore.setState({
      selectedProjectId: null,
      selectedJobTitle: null,
      selectedMemberId: null,
      multiSelectedIds: [],
    });
    useSettingsStore.setState({ schedulerMemberOrder: [] });
    useDatabaseStore.setState({
      databases: {
        [LC_SCHEDULER_DATABASE_ID]: {
          meta: {
            id: LC_SCHEDULER_DATABASE_ID,
            workspaceId: LC_SCHEDULER_WORKSPACE_ID,
            title: LC_SCHEDULER_DATABASE_TITLE,
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [{ id: "title", name: "Name", type: "title" }],
          presets: [],
          rowPageOrder: [],
        },
      },
      cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
      migrationQuarantine: [],
      dbTemplates: {},
    });
  });

  it("구성원 탭 자체를 drag surface로 사용하고 별도 핸들을 노출하지 않는다", () => {
    render(<SchedulerTeamTabs />);

    const tab = screen.getByText("가람").closest("button");
    expect(tab).toHaveAttribute("data-sortable-id", "member-1");
    expect(screen.queryByLabelText(/순서 변경/)).not.toBeInTheDocument();
  });

  it("구성원 탭 드래그 transform을 가로축으로만 제한한다", () => {
    render(<SchedulerTeamTabs />);

    const modifier = dndMockState.modifiers?.[0];
    expect(modifier).toBeTypeOf("function");
    expect(
      modifier?.({ transform: { x: 24, y: 40, scaleX: 1, scaleY: 1 } }),
    ).toEqual({ x: 24, y: 0, scaleX: 1, scaleY: 1 });
  });

  it("드래그한 구성원 순서와 field-level timestamp를 작업 DB panelState에 저장한다", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(12345);
    try {
      render(<SchedulerTeamTabs />);

      act(() => {
        dndMockState.onDragEnd?.({
          active: { id: "member-1" },
          over: { id: "member-2" },
        });
      });

      const panelState = useDatabaseStore.getState().databases[LC_SCHEDULER_DATABASE_ID]?.panelState;
      expect(panelState?.schedulerMemberOrder).toEqual(["member-2", "member-1"]);
      expect(panelState?.schedulerMemberOrderUpdatedAt).toBe(12345);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
