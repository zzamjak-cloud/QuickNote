import { appsyncClient } from "./graphql/client";
import { GET_WORKSPACE_META } from "./queries/workspaceMeta";
import type { Member } from "../../store/memberStore";
import type { Team } from "../../store/teamStore";
import type { Organization } from "../../store/organizationStore";
import type { SchedulerProject } from "../../store/schedulerProjectsStore";
import type { GqlProject } from "./graphql/operations";
import {
  type GqlMember,
  normalizeMemberFields,
} from "./memberNormalize";
import {
  GqlMemberSchema,
  GqlOrganizationSchema,
  GqlProjectSchema,
  GqlTeamSchema,
  parseGqlList,
} from "./schemas";

type GqlTeam = Omit<Team, "members"> & {
  members: GqlMember[];
};

type GqlOrganization = Omit<Organization, "members"> & {
  members: GqlMember[];
};

type WorkspaceMetaPayload = {
  members?: unknown;
  teams?: unknown;
  organizations?: unknown;
  projects?: unknown;
};

export type WorkspaceMeta = {
  members: Member[];
  teams: Team[];
  organizations: Organization[];
  projects: SchedulerProject[];
};

function normalizeTeam(team: GqlTeam): Team {
  return {
    ...team,
    leaderMemberIds: team.leaderMemberIds ?? [],
    members: team.members.map(normalizeMemberFields),
  };
}

function normalizeOrganization(organization: GqlOrganization): Organization {
  return {
    ...organization,
    leaderMemberIds: organization.leaderMemberIds ?? [],
    members: organization.members.map(normalizeMemberFields),
  };
}

function normalizeProject(project: GqlProject): SchedulerProject {
  return {
    ...(project as SchedulerProject),
    memberIds: project.memberIds ?? [],
    leaderMemberIds: project.leaderMemberIds ?? [],
  };
}

export async function getWorkspaceMetaApi(workspaceId: string): Promise<WorkspaceMeta> {
  const result = (await appsyncClient().graphql({
    query: GET_WORKSPACE_META,
    variables: { workspaceId },
  })) as { data?: { getWorkspaceMeta?: WorkspaceMetaPayload } };
  const payload = result.data?.getWorkspaceMeta ?? {};
  const members = parseGqlList(
    payload.members ?? [],
    GqlMemberSchema,
    "getWorkspaceMeta.members",
  ).map((member) => normalizeMemberFields(member as unknown as GqlMember));
  const teams = parseGqlList(
    payload.teams ?? [],
    GqlTeamSchema,
    "getWorkspaceMeta.teams",
  ).map((team) => normalizeTeam(team as unknown as GqlTeam));
  const organizations = parseGqlList(
    payload.organizations ?? [],
    GqlOrganizationSchema,
    "getWorkspaceMeta.organizations",
  ).map((organization) => normalizeOrganization(organization as unknown as GqlOrganization));
  const projects = parseGqlList(
    payload.projects ?? [],
    GqlProjectSchema,
    "getWorkspaceMeta.projects",
  ).map((project) => normalizeProject(project as unknown as GqlProject));

  return {
    members,
    teams,
    organizations,
    projects,
  };
}
