import type { Member } from "../../store/memberStore";
import type { Organization } from "../../store/organizationStore";
import type { SchedulerProject } from "../../store/schedulerProjectsStore";
import type { Team } from "../../store/teamStore";
import { LC_SCHEDULER_WORKSPACE_ID } from "./scope";

export type SchedulerScopeIds = {
  organizationId: string | null;
  teamId: string | null;
  projectId: string | null;
};

export type ResolveVisibleSchedulerMembersInput = {
  members: Member[];
  memberCacheWorkspaceId?: string | null;
  organizations: Organization[];
  organizationCacheWorkspaceId?: string | null;
  teams: Team[];
  teamCacheWorkspaceId?: string | null;
  projects: SchedulerProject[];
  projectCacheWorkspaceId?: string | null;
  selectedScopeKey?: string | null;
  selectedJobTitle?: string | null;
  ignoreJobFilter?: boolean;
  schedulerMemberOrder?: readonly string[];
};

export function parseSchedulerScopeKey(scopeKey?: string | null): SchedulerScopeIds {
  if (!scopeKey) {
    return { organizationId: null, teamId: null, projectId: null };
  }
  if (scopeKey.startsWith("org:")) {
    return { organizationId: scopeKey.slice("org:".length), teamId: null, projectId: null };
  }
  if (scopeKey.startsWith("team:")) {
    return { organizationId: null, teamId: scopeKey.slice("team:".length), projectId: null };
  }
  if (scopeKey.startsWith("proj:")) {
    return { organizationId: null, teamId: null, projectId: scopeKey.slice("proj:".length) };
  }
  return { organizationId: null, teamId: null, projectId: scopeKey };
}

export function sortMembersBySchedulerOrder(
  list: Member[],
  schedulerMemberOrder: readonly string[] = [],
): Member[] {
  const base = [...list].sort((a, b) => {
    const aActive = (a.employmentStatus ?? "재직중") === "재직중" ? 0 : 1;
    const bActive = (b.employmentStatus ?? "재직중") === "재직중" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return a.name.localeCompare(b.name, "ko");
  });
  if (schedulerMemberOrder.length === 0) return base;

  const order = new Map(schedulerMemberOrder.map((memberId, index) => [memberId, index]));
  return base.sort((a, b) => {
    const aOrder = order.get(a.memberId);
    const bOrder = order.get(b.memberId);
    if (aOrder != null && bOrder != null) return aOrder - bOrder;
    if (aOrder != null) return -1;
    if (bOrder != null) return 1;
    return 0;
  });
}

export function resolveVisibleSchedulerMembers(input: ResolveVisibleSchedulerMembersInput): Member[] {
  const {
    members,
    memberCacheWorkspaceId,
    organizations,
    organizationCacheWorkspaceId,
    teams,
    teamCacheWorkspaceId,
    projects,
    projectCacheWorkspaceId,
    selectedScopeKey,
    selectedJobTitle,
    ignoreJobFilter = false,
    schedulerMemberOrder = [],
  } = input;

  if (memberCacheWorkspaceId && memberCacheWorkspaceId !== LC_SCHEDULER_WORKSPACE_ID) {
    return [];
  }

  const jobFilter = ignoreJobFilter ? null : selectedJobTitle;
  const active = members
    .filter((member) => member.status === "active")
    .filter((member) => !jobFilter || member.jobCategory === jobFilter);
  const sortedActive = () => sortMembersBySchedulerOrder(active, schedulerMemberOrder);
  const scope = parseSchedulerScopeKey(selectedScopeKey);

  if (scope.organizationId) {
    if (organizationCacheWorkspaceId && organizationCacheWorkspaceId !== LC_SCHEDULER_WORKSPACE_ID) {
      return sortedActive();
    }
    const organization = organizations.find((item) => item.organizationId === scope.organizationId);
    if (!organization) return sortedActive();
    const ids = new Set(organization.members.map((member) => member.memberId));
    return sortMembersBySchedulerOrder(
      active.filter((member) => ids.has(member.memberId)),
      schedulerMemberOrder,
    );
  }

  if (scope.teamId) {
    if (teamCacheWorkspaceId && teamCacheWorkspaceId !== LC_SCHEDULER_WORKSPACE_ID) {
      return sortedActive();
    }
    const team = teams.find((item) => item.teamId === scope.teamId);
    if (!team) return sortedActive();
    const ids = new Set(team.members.map((member) => member.memberId));
    return sortMembersBySchedulerOrder(
      active.filter((member) => ids.has(member.memberId)),
      schedulerMemberOrder,
    );
  }

  if (scope.projectId) {
    if (projectCacheWorkspaceId && projectCacheWorkspaceId !== LC_SCHEDULER_WORKSPACE_ID) {
      return sortedActive();
    }
    const project = projects.find((item) => item.id === scope.projectId);
    if (!project) return sortedActive();
    const ids = new Set(project.memberIds);
    return sortMembersBySchedulerOrder(
      active.filter((member) => ids.has(member.memberId)),
      schedulerMemberOrder,
    );
  }

  return sortedActive();
}
