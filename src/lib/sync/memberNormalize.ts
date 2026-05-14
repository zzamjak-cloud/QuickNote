// Member GraphQL 응답 정규화 — memberApi/teamApi/organizationApi 가 공통 사용.
// 서버 enum 대문자 ↔ 클라이언트 소문자 변환 + 신규 7개 필드 매핑.

import type { Member } from "../../store/memberStore";

export type GqlMemberRoleEnum =
  | "DEVELOPER"
  | "OWNER"
  | "LEADER"
  | "MANAGER"
  | "MEMBER";

export type GqlMemberStatusEnum = "ACTIVE" | "REMOVED";

export type GqlMember = Omit<Member, "workspaceRole" | "status"> & {
  workspaceRole: GqlMemberRoleEnum;
  status: GqlMemberStatusEnum;
  cognitoSub?: string | null;
  createdAt?: string;
  removedAt?: string | null;
  clientPrefs?: unknown;
};

export function toMemberRole(
  role: GqlMemberRoleEnum | Member["workspaceRole"],
): Member["workspaceRole"] {
  if (role === "DEVELOPER" || role === "developer") return "developer";
  if (role === "OWNER" || role === "owner") return "owner";
  if (role === "LEADER" || role === "leader") return "leader";
  if (role === "MANAGER" || role === "manager") return "manager";
  return "member";
}

export function toMemberStatus(
  status: GqlMemberStatusEnum | Member["status"],
): Member["status"] {
  return status === "REMOVED" || status === "removed" ? "removed" : "active";
}

export function normalizeMemberFields(member: GqlMember | Member): Member {
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
    // 신규 필드 — GraphQL 응답에 포함된 경우에만 세팅
    employmentStatus: (member as Record<string, unknown>).employmentStatus as Member["employmentStatus"] | undefined,
    employeeNumber: (member as Record<string, unknown>).employeeNumber as string | undefined,
    department: (member as Record<string, unknown>).department as string | undefined,
    team: (member as Record<string, unknown>).team as string | undefined,
    jobCategory: (member as Record<string, unknown>).jobCategory as string | undefined,
    jobDetail: (member as Record<string, unknown>).jobDetail as string | undefined,
    joinedAt: (member as Record<string, unknown>).joinedAt as string | undefined,
  };
}
