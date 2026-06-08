import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../../lib/scheduler/scope";
import { makeLCSchedulerDatabaseId } from "../../../lib/scheduler/database";
import { makeLCFeatureDatabaseId } from "../../../lib/scheduler/featureDatabase";
import { makeLCMilestoneDatabaseId } from "../../../lib/scheduler/milestoneDatabase";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useOrganizationStore } from "../../../store/organizationStore";
import { useSchedulerHolidaysStore } from "../../../store/schedulerHolidaysStore";
import { useSchedulerProjectsStore } from "../../../store/schedulerProjectsStore";
import { useSchedulerStore } from "../../../store/schedulerStore";
import { useSchedulerViewStore } from "../../../store/schedulerViewStore";
import { useTeamStore } from "../../../store/teamStore";
import { LCSchedulerModal } from "../LCSchedulerModal";

const apiMocks = vi.hoisted(() => ({
  refreshWorkspaceMeta: vi.fn(() => Promise.resolve(true)),
  ensureDatabaseRowsLoaded: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("../../../lib/sync/workspaceMetaCache", () => ({
  refreshWorkspaceMeta: apiMocks.refreshWorkspaceMeta,
}));

vi.mock("../../../lib/sync/externalProtectedDatabaseLoad", () => ({
  ensureDatabaseRowsLoaded: apiMocks.ensureDatabaseRowsLoaded,
}));

vi.mock("../SchedulerHeader", () => ({
  SchedulerHeader: ({ onClose }: { onClose: () => void }) => (
    <button type="button" onClick={onClose}>
      close
    </button>
  ),
}));

vi.mock("../SchedulerToolbar", () => ({
  SchedulerToolbar: () => <div data-testid="scheduler-toolbar" />,
}));

vi.mock("../SchedulerTeamTabs", () => ({
  SchedulerTeamTabs: () => <div data-testid="scheduler-team-tabs" />,
}));

vi.mock("../mm/WeeklyMmPanel", () => ({
  WeeklyMmPanel: () => <div data-testid="weekly-mm-panel" />,
}));

vi.mock("../ScheduleGrid", () => ({
  ScheduleGrid: () => <div data-testid="schedule-grid" />,
}));

vi.mock("../WeekScheduleView", () => ({
  MonthScheduleView: () => <div data-testid="month-view" />,
  WeekScheduleView: () => <div data-testid="week-view" />,
}));

vi.mock("../SchedulerDatabaseTimeline", () => ({
  SchedulerDatabaseTimeline: () => <div data-testid="database-timeline" />,
}));

vi.mock("react-dom", async () => {
  const actual = await vi.importActual<typeof import("react-dom")>("react-dom");
  return {
    ...actual,
    createPortal: (children: ReactNode) => <>{children}</>,
  };
});

describe("LCSchedulerModal metadata refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    apiMocks.refreshWorkspaceMeta.mockClear();
    apiMocks.refreshWorkspaceMeta.mockResolvedValue(true);
    apiMocks.ensureDatabaseRowsLoaded.mockClear();
    apiMocks.ensureDatabaseRowsLoaded.mockResolvedValue(true);

    useSchedulerStore.setState({
      fetchSchedules: vi.fn(() => Promise.resolve()),
    });
    useSchedulerProjectsStore.setState({
      projects: [],
      fetchProjects: vi.fn(() => Promise.resolve([])),
    });
    useSchedulerHolidaysStore.setState({
      fetchHolidays: vi.fn(() => Promise.resolve([])),
    });
    useTeamStore.setState({ teams: [], cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID });
    useOrganizationStore.setState({ organizations: [], cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID });
    useSchedulerViewStore.setState({
      viewMode: "year",
      entityMode: "task",
      currentYear: 2026,
      selectedMemberId: "member-1",
      multiSelectedIds: ["member-2"],
    });
    useDatabaseStore.setState({ databases: {}, cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("loads workspace metadata once while the modal remains open", async () => {
    render(<LCSchedulerModal onClose={vi.fn()} />);

    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(2_500);
        await Promise.resolve();
      });
    }

    expect(apiMocks.refreshWorkspaceMeta).toHaveBeenCalledTimes(1);
    expect(apiMocks.refreshWorkspaceMeta).toHaveBeenCalledWith(LC_SCHEDULER_WORKSPACE_ID);
  });

  it("loads task, milestone, and feature database rows when the modal opens", async () => {
    render(<LCSchedulerModal onClose={vi.fn()} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(apiMocks.ensureDatabaseRowsLoaded).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseId: makeLCSchedulerDatabaseId(LC_SCHEDULER_WORKSPACE_ID),
        currentWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
        source: "lc-scheduler-modal",
      }),
    );
    expect(apiMocks.ensureDatabaseRowsLoaded).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseId: makeLCMilestoneDatabaseId(LC_SCHEDULER_WORKSPACE_ID),
        currentWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
        source: "lc-scheduler-modal",
      }),
    );
    expect(apiMocks.ensureDatabaseRowsLoaded).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseId: makeLCFeatureDatabaseId(LC_SCHEDULER_WORKSPACE_ID),
        currentWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
        source: "lc-scheduler-modal",
      }),
    );
  });
});
