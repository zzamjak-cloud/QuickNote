import { appsyncClient } from "./graphql/client";
import { CREATE_TEAM, DELETE_TEAM, LIST_TEAMS } from "./queries/team";
import type { Team } from "../../store/teamStore";
import type { Member } from "../../store/memberStore";

type GqlMember = Omit<Member, "workspaceRole" | "status"> & {
  workspaceRole: "OWNER" | "MANAGER" | "MEMBER";
  status: "ACTIVE" | "REMOVED";
};

type GqlTeam = Omit<Team, "members"> & {
  members: GqlMember[];
};

function normalizeMember(member: GqlMember): Member {
  return {
    ...member,
    workspaceRole:
      member.workspaceRole === "OWNER"
        ? "owner"
        : member.workspaceRole === "MANAGER"
          ? "manager"
          : "member",
    status: member.status === "REMOVED" ? "removed" : "active",
  };
}

function normalizeTeam(team: GqlTeam): Team {
  return { ...team, members: team.members.map(normalizeMember) };
}

export async function listTeamsApi(): Promise<Team[]> {
  const result = (await appsyncClient().graphql({
    query: LIST_TEAMS,
  })) as { data?: { listTeams?: GqlTeam[] } };
  return (result.data?.listTeams ?? []).map(normalizeTeam);
}

export async function createTeamApi(name: string): Promise<Team> {
  const result = (await appsyncClient().graphql({
    query: CREATE_TEAM,
    variables: { name },
  })) as { data?: { createTeam?: GqlTeam } };
  const team = result.data?.createTeam;
  if (!team) throw new Error("createTeam 응답이 비어 있습니다.");
  return normalizeTeam(team);
}

export async function deleteTeamApi(teamId: string): Promise<boolean> {
  const result = (await appsyncClient().graphql({
    query: DELETE_TEAM,
    variables: { teamId },
  })) as { data?: { deleteTeam?: boolean } };
  return Boolean(result.data?.deleteTeam);
}
