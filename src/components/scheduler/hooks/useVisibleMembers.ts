import { useMemo } from "react";
import { useMemberStore, type Member } from "../../../store/memberStore";
import { useOrganizationStore } from "../../../store/organizationStore";
import { useTeamStore } from "../../../store/teamStore";
import { useSchedulerViewStore } from "../../../store/schedulerViewStore";
import { useSchedulerProjectsStore } from "../../../store/schedulerProjectsStore";
import { useDatabaseStore } from "../../../store/databaseStore";
import { LC_SCHEDULER_DATABASE_ID } from "../../../lib/scheduler/database";
import {
  resolveVisibleSchedulerMembers,
  sortMembersBySchedulerOrder,
} from "../../../lib/scheduler/scopeMembers";

export { sortMembersBySchedulerOrder };

export function useVisibleMembers(options?: { ignoreJobFilter?: boolean }): Member[] {
  const ignoreJobFilter = options?.ignoreJobFilter ?? false;
  const members = useMemberStore((s) => s.members);
  const memberCacheWorkspaceId = useMemberStore((s) => s.cacheWorkspaceId);
  const organizations = useOrganizationStore((s) => s.organizations);
  const organizationCacheWorkspaceId = useOrganizationStore((s) => s.cacheWorkspaceId);
  const teams = useTeamStore((s) => s.teams);
  const teamCacheWorkspaceId = useTeamStore((s) => s.cacheWorkspaceId);
  const projects = useSchedulerProjectsStore((s) => s.projects);
  const projectCacheWorkspaceId = useSchedulerProjectsStore((s) => s.workspaceId);
  const selectedProjectId = useSchedulerViewStore((s) => s.selectedProjectId);
  const selectedJobTitle = useSchedulerViewStore((s) => s.selectedJobTitle);
  const schedulerMemberOrder = useDatabaseStore(
    (s) => s.databases[LC_SCHEDULER_DATABASE_ID]?.panelState?.schedulerMemberOrder,
  );

  return useMemo(() => (
    resolveVisibleSchedulerMembers({
      members,
      memberCacheWorkspaceId,
      organizations,
      organizationCacheWorkspaceId,
      teams,
      teamCacheWorkspaceId,
      projects,
      projectCacheWorkspaceId,
      selectedScopeKey: selectedProjectId,
      selectedJobTitle,
      ignoreJobFilter,
      schedulerMemberOrder,
    })
  ), [
    ignoreJobFilter,
    memberCacheWorkspaceId,
    members,
    organizationCacheWorkspaceId,
    organizations,
    projectCacheWorkspaceId,
    projects,
    schedulerMemberOrder,
    selectedJobTitle,
    selectedProjectId,
    teamCacheWorkspaceId,
    teams,
  ]);
}
