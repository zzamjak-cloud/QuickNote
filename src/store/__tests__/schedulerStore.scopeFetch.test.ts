import { beforeEach, describe, expect, it, vi } from "vitest";
import { LC_SCHEDULER_DATABASE_ID } from "../../lib/scheduler/database";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../lib/scheduler/scope";
import { fetchScheduleRange, type ScheduleRangeRequest } from "../../lib/sync/scheduleRangeApi";
import type { GqlSchedule } from "../../lib/sync/graphql/operations";
import type { Member } from "../memberStore";
import { useMemberStore } from "../memberStore";
import { useOrganizationStore } from "../organizationStore";
import { useSchedulerProjectsStore } from "../schedulerProjectsStore";
import { useSchedulerStore } from "../schedulerStore";
import { useSchedulerViewStore } from "../schedulerViewStore";
import { useTeamStore } from "../teamStore";

vi.mock("../../lib/scheduler/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/scheduler/database")>();
  return {
    ...actual,
    ensureLCSchedulerDatabase: vi.fn(() => Promise.resolve()),
  };
});

vi.mock("../../lib/scheduler/milestoneDatabase", () => ({
  ensureLCMilestoneDatabase: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../lib/scheduler/featureDatabase", () => ({
  ensureLCFeatureDatabase: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../lib/scheduler/schedulerReconcileCache", () => ({
  readSchedulerReconcileWatermark: vi.fn(() => Promise.resolve(null)),
  resolveNextSchedulerReconcileWatermark: vi.fn((updatedAfter: string) => updatedAfter),
  writeSchedulerReconcileWatermark: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../lib/sync/bootstrap", () => ({
  fetchPagesByWorkspace: vi.fn(() => Promise.resolve([])),
  fetchDatabasesByWorkspace: vi.fn(() => Promise.resolve([])),
}));

vi.mock("../../lib/sync/runtime", () => ({
  getSyncEngine: vi.fn(() => Promise.resolve({
    flush: vi.fn(() => Promise.resolve()),
    debugSnapshot: vi.fn(() => Promise.resolve([])),
  })),
}));

vi.mock("../../lib/sync/storeApply", () => ({
  applyRemotePagesToStore: vi.fn(),
  reconcileLCSchedulerRemoteSnapshot: vi.fn(),
}));

vi.mock("../../lib/sync/scheduleRangeApi", () => ({
  fetchScheduleRange: vi.fn(),
  extractScheduleRangeSourcePages: vi.fn(() => []),
}));

const fetchScheduleRangeMock = vi.mocked(fetchScheduleRange);

const range = {
  from: "2026-01-01T00:00:00.000Z",
  to: "2026-12-31T23:59:59.999Z",
};

function member(memberId: string, name: string): Member {
  return {
    memberId,
    email: `${memberId}@example.com`,
    name,
    jobRole: "developer",
    workspaceRole: "member",
    status: "active",
    personalWorkspaceId: `personal-${memberId}`,
  };
}

function gqlSchedule(input: {
  pageId: string;
  assigneeId: string | null;
  projectId: string | null;
  title: string;
}): GqlSchedule {
  return {
    id: `${input.pageId}::${input.assigneeId ?? "__global__"}`,
    sourcePageId: input.pageId,
    sourcePage: {
      id: input.pageId,
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
      createdByMemberId: "creator-1",
      title: input.title,
      icon: null,
      parentId: null,
      order: 0,
      databaseId: LC_SCHEDULER_DATABASE_ID,
      doc: { type: "doc", content: [] },
      dbCells: {},
      blockComments: {},
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
      deletedAt: null,
    },
    workspaceId: LC_SCHEDULER_WORKSPACE_ID,
    title: input.title,
    comment: null,
    link: null,
    projectId: input.projectId,
    teamId: null,
    organizationId: null,
    kind: "schedule",
    startAt: "2026-06-01T00:00:00.000Z",
    endAt: "2026-06-02T23:59:59.999Z",
    assigneeId: input.assigneeId,
    color: null,
    textColor: null,
    rowIndex: 0,
    createdByMemberId: "creator-1",
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z",
  };
}

function standaloneSchedule(input: {
  id: string;
  assigneeId: string | null;
  projectId: string | null;
  title: string;
}): GqlSchedule {
  return {
    id: input.id,
    sourcePageId: null,
    sourcePage: null,
    workspaceId: LC_SCHEDULER_WORKSPACE_ID,
    title: input.title,
    comment: null,
    link: null,
    projectId: input.projectId,
    teamId: null,
    organizationId: null,
    kind: "schedule",
    startAt: "2026-06-01T00:00:00.000Z",
    endAt: "2026-06-02T23:59:59.999Z",
    assigneeId: input.assigneeId,
    color: null,
    textColor: null,
    rowIndex: 0,
    createdByMemberId: "creator-1",
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z",
  };
}

function requests(): ScheduleRangeRequest[] {
  return fetchScheduleRangeMock.mock.calls.map(([request]) => request);
}

describe("schedulerStore scope range fetch", () => {
  beforeEach(() => {
    fetchScheduleRangeMock.mockReset();
    useSchedulerStore.setState({
      schedules: [],
      loading: false,
      cachedWorkspaceId: null,
      visibleRangeFrom: null,
      visibleRangeTo: null,
      cachedScopeKey: null,
    });
    useSchedulerViewStore.setState({
      selectedProjectId: null,
      selectedMemberId: null,
      selectedJobTitle: null,
      multiSelectedIds: [],
    });
    useMemberStore.setState({
      members: [],
      cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
      lastFetchedAt: Date.now(),
    });
    useOrganizationStore.setState({
      organizations: [],
      cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
      lastFetchedAt: Date.now(),
    });
    useTeamStore.setState({
      teams: [],
      cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
      lastFetchedAt: Date.now(),
    });
    useSchedulerProjectsStore.setState({
      projects: [],
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
      lastFetchedAt: Date.now(),
    });
  });

  it("loads every visible project member by assignee without constraining their schedules to that project", async () => {
    const alice = member("member-1", "Alice");
    const bob = member("member-2", "Bob");
    const charlie = member("member-3", "Charlie");
    useMemberStore.setState({
      members: [alice, bob, charlie],
      cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
    });
    useSchedulerProjectsStore.setState({
      projects: [
        {
          id: "project-1",
          workspaceId: LC_SCHEDULER_WORKSPACE_ID,
          name: "Project 1",
          color: "#2563eb",
          memberIds: ["member-1", "member-2"],
          leaderMemberIds: [],
          isHidden: false,
          createdByMemberId: "creator-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
    });
    useSchedulerViewStore.setState({
      selectedProjectId: "proj:project-1",
      selectedMemberId: null,
    });
    // 서버 scoped 쿼리는 raw 셀만 필터해 파생(상속) 스코프 행을 놓치므로,
    // 범위 조회는 항상 unscoped 1건이고 스코프 판정은 클라 필터가 수행한다.
    fetchScheduleRangeMock.mockImplementation(async () => [
      gqlSchedule({
        pageId: "task-member-1-other-project",
        assigneeId: "member-1",
        projectId: "project-2",
        title: "Alice other project",
      }),
      gqlSchedule({
        pageId: "task-member-2-other-project",
        assigneeId: "member-2",
        projectId: "project-3",
        title: "Bob other project",
      }),
      gqlSchedule({
        pageId: "global-project-1",
        assigneeId: null,
        projectId: "project-1",
        title: "Project global",
      }),
      // 스코프 밖(비멤버 배정 + 타 프로젝트) — 클라 필터가 제외해야 함
      gqlSchedule({
        pageId: "task-member-3-other-project",
        assigneeId: "member-3",
        projectId: "project-4",
        title: "Charlie unrelated",
      }),
    ]);

    await useSchedulerStore.getState().fetchSchedules(
      LC_SCHEDULER_WORKSPACE_ID,
      range.from,
      range.to,
    );

    expect(requests()).toEqual([
      expect.objectContaining({
        projectId: null,
        teamId: null,
        organizationId: null,
        assigneeId: null,
      }),
    ]);
    expect(useSchedulerStore.getState().schedules.map((schedule) => schedule.title).sort()).toEqual([
      "Alice other project",
      "Bob other project",
      "Project global",
    ]);
  });

  it("keeps selected member fetches assignee-scoped and still loads the selected scope globals", async () => {
    const alice = member("member-1", "Alice");
    const bob = member("member-2", "Bob");
    useMemberStore.setState({
      members: [alice, bob],
      cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
    });
    useSchedulerProjectsStore.setState({
      projects: [
        {
          id: "project-1",
          workspaceId: LC_SCHEDULER_WORKSPACE_ID,
          name: "Project 1",
          color: "#2563eb",
          memberIds: ["member-1", "member-2"],
          leaderMemberIds: [],
          isHidden: false,
          createdByMemberId: "creator-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
    });
    useSchedulerViewStore.setState({
      selectedProjectId: "proj:project-1",
      selectedMemberId: "member-2",
    });
    fetchScheduleRangeMock.mockImplementation(async () => [
      gqlSchedule({
        pageId: "task-member-2-other-project",
        assigneeId: "member-2",
        projectId: "project-9",
        title: "Bob outside selected project",
      }),
      gqlSchedule({
        pageId: "global-project-1",
        assigneeId: null,
        projectId: "project-1",
        title: "Project global",
      }),
      // 선택 구성원도 아니고 스코프 일치도 아님 — 제외 대상
      gqlSchedule({
        pageId: "task-member-1-other-project",
        assigneeId: "member-1",
        projectId: "project-9",
        title: "Alice outside selected project",
      }),
    ]);

    await useSchedulerStore.getState().fetchSchedules(
      LC_SCHEDULER_WORKSPACE_ID,
      range.from,
      range.to,
    );

    expect(requests()).toEqual([
      expect.objectContaining({
        projectId: null,
        teamId: null,
        organizationId: null,
        assigneeId: null,
      }),
    ]);
    expect(useSchedulerStore.getState().schedules.map((schedule) => schedule.title).sort()).toEqual([
      "Bob outside selected project",
      "Project global",
    ]);
  });

  it("does not project standalone schedule records that are not backed by task database pages", async () => {
    const alice = member("member-1", "Alice");
    useMemberStore.setState({
      members: [alice],
      cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
    });
    useSchedulerProjectsStore.setState({
      projects: [
        {
          id: "project-1",
          workspaceId: LC_SCHEDULER_WORKSPACE_ID,
          name: "Project 1",
          color: "#2563eb",
          memberIds: ["member-1"],
          leaderMemberIds: [],
          isHidden: false,
          createdByMemberId: "creator-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
    });
    useSchedulerViewStore.setState({
      selectedProjectId: "proj:project-1",
      selectedMemberId: null,
    });
    fetchScheduleRangeMock.mockImplementation(async () => [
      standaloneSchedule({
        id: "sch_ghost_1",
        assigneeId: "member-1",
        projectId: "project-1",
        title: "테스트 2",
      }),
      gqlSchedule({
        pageId: "task-member-1",
        assigneeId: "member-1",
        projectId: "project-1",
        title: "Real task",
      }),
    ]);

    await useSchedulerStore.getState().fetchSchedules(
      LC_SCHEDULER_WORKSPACE_ID,
      range.from,
      range.to,
    );

    expect(useSchedulerStore.getState().schedules.map((schedule) => schedule.title)).toEqual([
      "Real task",
    ]);
  });

  it("invalidates older cached ranges so previously persisted ghost cards are replaced", async () => {
    const alice = member("member-1", "Alice");
    useMemberStore.setState({
      members: [alice],
      cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
    });
    useSchedulerProjectsStore.setState({
      projects: [
        {
          id: "project-1",
          workspaceId: LC_SCHEDULER_WORKSPACE_ID,
          name: "Project 1",
          color: "#2563eb",
          memberIds: ["member-1"],
          leaderMemberIds: [],
          isHidden: false,
          createdByMemberId: "creator-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
    });
    useSchedulerViewStore.setState({
      selectedProjectId: "proj:project-1",
      selectedMemberId: null,
    });
    useSchedulerStore.setState({
      schedules: [
        {
          id: "sch_ghost_1",
          workspaceId: LC_SCHEDULER_WORKSPACE_ID,
          title: "테스트 2",
          startAt: "2026-06-01T00:00:00.000Z",
          endAt: "2026-06-02T23:59:59.999Z",
          assigneeId: "member-1",
          createdByMemberId: "creator-1",
          createdAt: "2026-05-31T00:00:00.000Z",
          updatedAt: "2026-05-31T00:00:00.000Z",
        },
      ],
      cachedWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
      visibleRangeFrom: range.from,
      visibleRangeTo: range.to,
      cachedScopeKey: JSON.stringify({
        scopeKey: "proj:project-1",
        assigneeId: null,
        selectedJobTitle: null,
      }),
    });
    fetchScheduleRangeMock.mockImplementation(async () => [
      gqlSchedule({
        pageId: "task-member-1",
        assigneeId: "member-1",
        projectId: "project-1",
        title: "Real task",
      }),
    ]);

    await useSchedulerStore.getState().fetchSchedules(
      LC_SCHEDULER_WORKSPACE_ID,
      range.from,
      range.to,
    );

    // cache-hit 경로는 백그라운드 재검증(void)이라 완료를 기다려 단언한다
    await vi.waitFor(() => {
      expect(fetchScheduleRangeMock).toHaveBeenCalled();
      expect(useSchedulerStore.getState().schedules.map((schedule) => schedule.title)).toEqual([
        "Real task",
      ]);
    });
  });
});
