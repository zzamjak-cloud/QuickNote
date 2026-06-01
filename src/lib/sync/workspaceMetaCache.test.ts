import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LC_SCHEDULER_WORKSPACE_ID } from "../scheduler/scope";
import { useMemberStore } from "../../store/memberStore";
import { useOrganizationStore } from "../../store/organizationStore";
import { useSchedulerProjectsStore } from "../../store/schedulerProjectsStore";
import { useTeamStore } from "../../store/teamStore";
import { isWorkspaceMetaCacheFresh, refreshWorkspaceMeta } from "./workspaceMetaCache";

const apiMocks = vi.hoisted(() => ({
  getWorkspaceMetaApi: vi.fn(),
}));

vi.mock("./workspaceMetaApi", () => ({
  getWorkspaceMetaApi: apiMocks.getWorkspaceMetaApi,
}));

describe("workspace metadata cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-02T00:00:00.000Z"));
    apiMocks.getWorkspaceMetaApi.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("treats empty but recently fetched metadata as fresh", async () => {
    const fetchedAt = Date.now();
    useMemberStore.setState({
      members: [],
      cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
      lastFetchedAt: fetchedAt,
    });
    useTeamStore.setState({
      teams: [],
      cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
      lastFetchedAt: fetchedAt,
    });
    useOrganizationStore.setState({
      organizations: [],
      cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
      lastFetchedAt: fetchedAt,
    });
    useSchedulerProjectsStore.setState({
      projects: [],
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
      lastFetchedAt: fetchedAt,
    });

    expect(isWorkspaceMetaCacheFresh(LC_SCHEDULER_WORKSPACE_ID)).toBe(true);
    await expect(refreshWorkspaceMeta(LC_SCHEDULER_WORKSPACE_ID)).resolves.toBe(false);
    expect(apiMocks.getWorkspaceMetaApi).not.toHaveBeenCalled();
  });
});
