import { appsyncClient } from "./graphql/client";
import {
  ASSIGN_MEMBER_TO_TEAM,
  CREATE_MEMBER,
  DEMOTE_TO_MEMBER,
  LIST_MEMBERS,
  ME,
  SEARCH_MEMBERS_FOR_MENTION,
  PROMOTE_TO_MANAGER,
  REMOVE_MEMBER,
  UNASSIGN_MEMBER_FROM_TEAM,
} from "./queries/member";
import type { Member, MemberMini } from "../../store/memberStore";

type CreateMemberInput = {
  email: string;
  name: string;
  jobRole: string;
  workspaceRole?: "OWNER" | "MANAGER" | "MEMBER";
  teamIds?: string[];
};

type GqlMember = Omit<Member, "workspaceRole" | "status"> & {
  workspaceRole: "OWNER" | "MANAGER" | "MEMBER";
  status: "ACTIVE" | "REMOVED";
};

function toMemberRole(role: GqlMember["workspaceRole"] | Member["workspaceRole"]): Member["workspaceRole"] {
  if (role === "OWNER" || role === "owner") return "owner";
  if (role === "MANAGER" || role === "manager") return "manager";
  return "member";
}

function toMemberStatus(status: GqlMember["status"] | Member["status"]): Member["status"] {
  return status === "REMOVED" || status === "removed" ? "removed" : "active";
}

function normalizeMember(member: GqlMember | Member): Member {
  return {
    ...member,
    workspaceRole: toMemberRole(member.workspaceRole),
    status: toMemberStatus(member.status),
  };
}

export async function meApi(): Promise<Member> {
  const result = (await appsyncClient().graphql({
    query: ME,
  })) as { data?: { me?: GqlMember } };
  const me = result.data?.me;
  if (!me) throw new Error("me 응답이 비어 있습니다.");
  return normalizeMember(me);
}

export async function listMembersApi(): Promise<Member[]> {
  const result = (await appsyncClient().graphql({
    query: LIST_MEMBERS,
  })) as { data?: { listMembers?: GqlMember[] } };
  return (result.data?.listMembers ?? []).map(normalizeMember);
}

export async function createMemberApi(input: CreateMemberInput): Promise<Member> {
  const result = (await appsyncClient().graphql({
    query: CREATE_MEMBER,
    variables: { input },
  })) as { data?: { createMember?: GqlMember } };
  const member = result.data?.createMember;
  if (!member) {
    throw new Error("createMember 응답이 비어 있습니다.");
  }
  return normalizeMember(member);
}

export async function promoteToManagerApi(memberId: string): Promise<Member> {
  const result = (await appsyncClient().graphql({
    query: PROMOTE_TO_MANAGER,
    variables: { memberId },
  })) as { data?: { promoteToManager?: GqlMember } };
  const member = result.data?.promoteToManager;
  if (!member) throw new Error("promoteToManager 응답이 비어 있습니다.");
  return normalizeMember(member);
}

export async function demoteToMemberApi(memberId: string): Promise<Member> {
  const result = (await appsyncClient().graphql({
    query: DEMOTE_TO_MEMBER,
    variables: { memberId },
  })) as { data?: { demoteToMember?: GqlMember } };
  const member = result.data?.demoteToMember;
  if (!member) throw new Error("demoteToMember 응답이 비어 있습니다.");
  return normalizeMember(member);
}

export async function removeMemberApi(memberId: string): Promise<Member> {
  const result = (await appsyncClient().graphql({
    query: REMOVE_MEMBER,
    variables: { memberId },
  })) as { data?: { removeMember?: GqlMember } };
  const member = result.data?.removeMember;
  if (!member) throw new Error("removeMember 응답이 비어 있습니다.");
  return normalizeMember(member);
}

export async function assignMemberToTeamApi(memberId: string, teamId: string): Promise<boolean> {
  const result = (await appsyncClient().graphql({
    query: ASSIGN_MEMBER_TO_TEAM,
    variables: { memberId, teamId },
  })) as { data?: { assignMemberToTeam?: boolean } };
  return Boolean(result.data?.assignMemberToTeam);
}

export async function unassignMemberFromTeamApi(memberId: string, teamId: string): Promise<boolean> {
  const result = (await appsyncClient().graphql({
    query: UNASSIGN_MEMBER_FROM_TEAM,
    variables: { memberId, teamId },
  })) as { data?: { unassignMemberFromTeam?: boolean } };
  return Boolean(result.data?.unassignMemberFromTeam);
}

export async function searchMembersForMentionApi(
  query: string,
  limit = 8,
): Promise<MemberMini[]> {
  const result = (await appsyncClient().graphql({
    query: SEARCH_MEMBERS_FOR_MENTION,
    variables: {
      query: query.trim() || undefined,
      limit,
    },
  })) as { data?: { searchMembersForMention?: MemberMini[] } };
  return result.data?.searchMembersForMention ?? [];
}
