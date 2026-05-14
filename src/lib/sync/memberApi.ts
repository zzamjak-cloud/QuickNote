import { appsyncClient } from "./graphql/client";
import {
  ASSIGN_MEMBER_TO_TEAM,
  CREATE_MEMBER,
  DEMOTE_TO_MEMBER,
  LIST_MEMBERS,
  ME,
  SEARCH_MEMBERS_FOR_MENTION,
  PROMOTE_TO_MANAGER,
  SET_MEMBER_ROLE,
  REMOVE_MEMBER,
  UNASSIGN_MEMBER_FROM_TEAM,
  UPDATE_MEMBER,
  RESTORE_MEMBER,
} from "./queries/member";
import type { Member, MemberMini } from "../../store/memberStore";

type CreateMemberInput = {
  email: string;
  name: string;
  jobRole: string;
  workspaceRole?: "DEVELOPER" | "OWNER" | "LEADER" | "MANAGER" | "MEMBER";
  teamIds?: string[];
};

type UpdateMemberInput = {
  name?: string | null;
  jobRole?: string | null;
  jobTitle?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  thumbnailUrl?: string | null;
};

type GqlMember = Omit<Member, "workspaceRole" | "status"> & {
  workspaceRole: "DEVELOPER" | "OWNER" | "LEADER" | "MANAGER" | "MEMBER";
  status: "ACTIVE" | "REMOVED";
  cognitoSub?: string | null;
  createdAt: string;
  removedAt?: string | null;
  clientPrefs?: unknown;
};

/** me 쿼리 전체 결과 + 동기화용 clientPrefs 원본 */
type GqlMePayload = GqlMember;

function toMemberRole(role: GqlMember["workspaceRole"] | Member["workspaceRole"]): Member["workspaceRole"] {
  if (role === "DEVELOPER" || role === "developer") return "developer";
  if (role === "OWNER" || role === "owner") return "owner";
  if (role === "LEADER" || role === "leader") return "leader";
  if (role === "MANAGER" || role === "manager") return "manager";
  return "member";
}

function toMemberStatus(status: GqlMember["status"] | Member["status"]): Member["status"] {
  return status === "REMOVED" || status === "removed" ? "removed" : "active";
}

function normalizeMemberFields(member: GqlMember | Member): Member {
  return {
    memberId: member.memberId,
    email: member.email,
    name: member.name,
    jobRole: member.jobRole,
    workspaceRole: toMemberRole(member.workspaceRole),
    status: toMemberStatus(member.status),
    jobTitle: member.jobTitle,
    phone: member.phone,
    avatarUrl: member.avatarUrl,
    thumbnailUrl: member.thumbnailUrl,
    personalWorkspaceId: member.personalWorkspaceId,
  };
}

/** 인증 초기 로드 및 prefs 동기화에 사용한다. clientPrefs 로컬 적용 후 member 만 스토어에 넣으면 된다. */
export type MeWithPrefs = {
  member: Member;
  clientPrefs: unknown;
};

export async function fetchMeWithClientPrefs(): Promise<MeWithPrefs> {
  const result = (await appsyncClient().graphql({
    query: ME,
  })) as { data?: { me?: GqlMePayload } };
  const me = result.data?.me;
  if (!me) throw new Error("me 응답이 비어 있습니다.");
  const rawPrefs = me.clientPrefs;
  const member = normalizeMemberFields(me);
  return { member, clientPrefs: rawPrefs ?? null };
}

export async function meApi(): Promise<Member> {
  const { member } = await fetchMeWithClientPrefs();
  return member;
}

export async function listMembersApi(): Promise<Member[]> {
  const result = (await appsyncClient().graphql({
    query: LIST_MEMBERS,
  })) as { data?: { listMembers?: GqlMember[] } };
  return (result.data?.listMembers ?? []).map(normalizeMemberFields);
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
  return normalizeMemberFields(member);
}

export async function promoteToManagerApi(memberId: string): Promise<Member> {
  const result = (await appsyncClient().graphql({
    query: PROMOTE_TO_MANAGER,
    variables: { memberId },
  })) as { data?: { promoteToManager?: GqlMember } };
  const member = result.data?.promoteToManager;
  if (!member) throw new Error("promoteToManager 응답이 비어 있습니다.");
  return normalizeMemberFields(member);
}

export async function demoteToMemberApi(memberId: string): Promise<Member> {
  const result = (await appsyncClient().graphql({
    query: DEMOTE_TO_MEMBER,
    variables: { memberId },
  })) as { data?: { demoteToMember?: GqlMember } };
  const member = result.data?.demoteToMember;
  if (!member) throw new Error("demoteToMember 응답이 비어 있습니다.");
  return normalizeMemberFields(member);
}

export async function setMemberRoleApi(memberId: string, role: string): Promise<Member> {
  const result = (await appsyncClient().graphql({
    query: SET_MEMBER_ROLE,
    variables: { memberId, role: role.toUpperCase() },
  })) as { data?: { setMemberRole?: GqlMember } };
  const member = result.data?.setMemberRole;
  if (!member) throw new Error("setMemberRole 응답이 비어 있습니다.");
  return normalizeMemberFields(member);
}

export async function removeMemberApi(memberId: string): Promise<Member> {
  const result = (await appsyncClient().graphql({
    query: REMOVE_MEMBER,
    variables: { memberId },
  })) as { data?: { removeMember?: GqlMember } };
  const member = result.data?.removeMember;
  if (!member) throw new Error("removeMember 응답이 비어 있습니다.");
  return normalizeMemberFields(member);
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

export async function updateMemberApi(memberId: string, input: UpdateMemberInput): Promise<Member> {
  const result = (await appsyncClient().graphql({
    query: UPDATE_MEMBER,
    variables: { memberId, ...input },
  })) as { data?: { updateMember?: GqlMember } };
  const member = result.data?.updateMember;
  if (!member) throw new Error("updateMember 응답이 비어 있습니다.");
  return normalizeMemberFields(member);
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

export async function restoreMemberApi(memberId: string): Promise<Member> {
  const result = (await appsyncClient().graphql({
    query: RESTORE_MEMBER,
    variables: { memberId },
  })) as { data?: { restoreMember?: GqlMember } };
  const member = result.data?.restoreMember;
  if (!member) throw new Error("restoreMember 응답이 비어 있습니다.");
  return normalizeMemberFields(member);
}

