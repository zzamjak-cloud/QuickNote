import { useMemberStore } from "../../store/memberStore";
import type { MemberMini } from "../../store/memberStore";

/** 워크스페이스 멤버 목록에서 이름·이메일 부분일치(대소문자 무시) */
export function filterWorkspaceMembersForMention(
  query: string,
  limit: number,
): MemberMini[] {
  const q = query.trim().toLowerCase();
  const members = useMemberStore
    .getState()
    .members.filter((m) => m.status !== "removed");

  const toMini = (m: (typeof members)[0]): MemberMini => ({
    memberId: m.memberId,
    name: m.name,
    jobRole: m.jobRole,
  });

  if (!q) {
    return members.slice(0, limit).map(toMini);
  }

  return members
    .filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q),
    )
    .slice(0, limit)
    .map(toMini);
}
