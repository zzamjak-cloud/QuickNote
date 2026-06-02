import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { forwardRef, useImperativeHandle, useRef, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANNUAL_LEAVE_COLOR, DEFAULT_SCHEDULE_COLOR, COLOR_PRESETS } from "../../../lib/scheduler/colors";
import { useMemberStore } from "../../../store/memberStore";
import { useOrganizationStore } from "../../../store/organizationStore";
import { usePageStore } from "../../../store/pageStore";
import { useSchedulerProjectsStore } from "../../../store/schedulerProjectsStore";
import { type Schedule, useSchedulerStore } from "../../../store/schedulerStore";
import { useSchedulerViewStore } from "../../../store/schedulerViewStore";
import { useTeamStore } from "../../../store/teamStore";
import { ScheduleCard } from "../ScheduleCard";

vi.mock("react-rnd", () => ({
  Rnd: forwardRef(
    ({
      children,
      className,
      style,
      onMouseDown,
    }: {
      children: ReactNode;
      className?: string;
      style?: React.CSSProperties;
      onMouseDown?: (event: MouseEvent) => void;
    }, ref) => {
      const elementRef = useRef<HTMLDivElement>(null);
      useImperativeHandle(ref, () => ({
        getSelfElement: () => elementRef.current,
      }));
      return (
        <div
          ref={elementRef}
          data-testid="schedule-rnd"
          className={className}
          style={style}
          onMouseDown={(event) => onMouseDown?.(event.nativeEvent)}
        >
          {children}
        </div>
      );
    },
  ),
}));

vi.mock("../../../lib/sync/runtime", () => ({
  enqueueAsync: vi.fn(),
}));

const schedule: Schedule = {
  id: "schedule-1",
  workspaceId: "workspace-1",
  title: "Schedule",
  comment: null,
  link: null,
  kind: "schedule",
  projectId: null,
  teamId: null,
  organizationId: null,
  startAt: "2026-12-01T00:00:00.000Z",
  endAt: "2026-12-03T23:59:59.999Z",
  assigneeId: "member-1",
  color: DEFAULT_SCHEDULE_COLOR,
  textColor: "#ffffff",
  rowIndex: 0,
  createdByMemberId: "member-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("ScheduleCard context menu", () => {
  const updateSchedule = vi.fn(() => Promise.resolve(schedule));

  beforeEach(() => {
    updateSchedule.mockClear();
    useSchedulerStore.setState({
      schedules: [schedule],
      updateSchedule,
      createSchedule: vi.fn(),
    });
    useMemberStore.setState({ members: [], cacheWorkspaceId: "workspace-1" });
    useSchedulerProjectsStore.setState({ projects: [], cacheWorkspaceId: "workspace-1" });
    useOrganizationStore.setState({ organizations: [], cacheWorkspaceId: "workspace-1" });
    useTeamStore.setState({ teams: [], cacheWorkspaceId: "workspace-1" });
    useSchedulerViewStore.setState({ zoomLevel: 1 });
    usePageStore.setState({ pages: {}, activePageId: null, cacheWorkspaceId: "workspace-1" });
  });

  it("includes default schedule and annual leave colors in color presets", () => {
    expect(COLOR_PRESETS).toContain("#2563eb");
    expect(COLOR_PRESETS).toContain(ANNUAL_LEAVE_COLOR);
  });

  it("opens color preset menu from the Rnd wrapper right click", () => {
    render(
      <ScheduleCard
        schedule={schedule}
        year={2026}
        cellWidth={12}
        rowHeight={40}
        rowCount={1}
        isSelected={false}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    const wrapper = screen.getByTestId("schedule-rnd");
    const event = createEvent.mouseDown(wrapper, {
      button: 2,
      clientX: 80,
      clientY: 90,
    });

    fireEvent(wrapper, event);

    expect(event.defaultPrevented).toBe(true);
    const contextMenuEvent = createEvent.contextMenu(wrapper, {
      clientX: 80,
      clientY: 90,
    });
    fireEvent(wrapper, contextMenuEvent);
    expect(contextMenuEvent.defaultPrevented).toBe(true);

    const nextColor = COLOR_PRESETS.find((color) => color !== DEFAULT_SCHEDULE_COLOR);
    expect(nextColor).toBeDefined();

    fireEvent.click(screen.getByTitle(nextColor as string));

    expect(updateSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        id: schedule.id,
        workspaceId: schedule.workspaceId,
        color: nextColor,
        colorScope: "card",
      }),
    );
  });

  it("marks the default blue preset selected even when current color casing differs", () => {
    render(
      <ScheduleCard
        schedule={{ ...schedule, color: DEFAULT_SCHEDULE_COLOR.toLowerCase() }}
        year={2026}
        cellWidth={12}
        rowHeight={40}
        rowCount={1}
        isSelected={false}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    const wrapper = screen.getByTestId("schedule-rnd");
    fireEvent(
      wrapper,
      createEvent.mouseDown(wrapper, {
        button: 2,
        clientX: 80,
        clientY: 90,
      }),
    );

    expect(screen.getByTitle(DEFAULT_SCHEDULE_COLOR)).toHaveClass("ring-blue-500");
  });

  it("keeps one color preset menu when another schedule card is right clicked", () => {
    const otherSchedule: Schedule = {
      ...schedule,
      id: "schedule-2",
      title: "Other Schedule",
      rowIndex: 1,
    };
    useSchedulerStore.setState({
      schedules: [schedule, otherSchedule],
      updateSchedule,
      createSchedule: vi.fn(),
    });

    render(
      <>
        <ScheduleCard
          schedule={schedule}
          year={2026}
          cellWidth={12}
          rowHeight={80}
          rowCount={2}
          isSelected={false}
          onSelect={vi.fn()}
          onEdit={vi.fn()}
        />
        <ScheduleCard
          schedule={otherSchedule}
          year={2026}
          cellWidth={12}
          rowHeight={80}
          rowCount={2}
          isSelected={false}
          onSelect={vi.fn()}
          onEdit={vi.fn()}
        />
      </>,
    );

    const wrappers = screen.getAllByTestId("schedule-rnd");
    expect(wrappers).toHaveLength(2);

    fireEvent(
      wrappers[0]!,
      createEvent.mouseDown(wrappers[0]!, {
        button: 2,
        clientX: 80,
        clientY: 90,
      }),
    );
    expect(screen.getAllByText("색상 변경")).toHaveLength(1);

    fireEvent(
      wrappers[1]!,
      createEvent.mouseDown(wrappers[1]!, {
        button: 2,
        clientX: 120,
        clientY: 140,
      }),
    );

    expect(screen.getAllByText("색상 변경")).toHaveLength(1);
  });
});
