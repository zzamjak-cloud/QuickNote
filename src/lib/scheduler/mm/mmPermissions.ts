import type { Member, MemberRole } from "../../../store/memberStore";
import type { MmEntryStatus } from "./mmTypes";

export const MM_ADMIN_ROLES = new Set<MemberRole>([
  "developer",
  "owner",
  "leader",
  "manager",
]);

export function isMmAdmin(member: Pick<Member, "workspaceRole" | "status"> | null | undefined): boolean {
  return Boolean(member && member.status === "active" && MM_ADMIN_ROLES.has(member.workspaceRole));
}

export function canEditWeeklyMmInput(args: {
  viewer: Pick<Member, "memberId" | "workspaceRole" | "status"> | null | undefined;
  targetMemberId: string;
  status?: MmEntryStatus | null;
}): boolean {
  const { viewer, targetMemberId, status } = args;
  if (!viewer || viewer.status !== "active") return false;
  if (status === "locked") return false;
  if (viewer.memberId === targetMemberId) return true;
  return isMmAdmin(viewer);
}

export function canManageMmDashboard(
  viewer: Pick<Member, "workspaceRole" | "status"> | null | undefined,
): boolean {
  return isMmAdmin(viewer);
}
