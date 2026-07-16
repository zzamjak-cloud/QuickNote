import { useMemberStore } from "../../store/memberStore";
import type { MemberMini } from "../../store/memberStore";
import { koreanIncludes } from "../koreanSearch";

/** 워크스페이스 멤버 목록에서 이름·이메일 부분일치(대소문자 무시) */
export function filterWorkspaceMembersForMention(
  query: string,
  limit: number,
): MemberMini[] {
  const q = query.trim().toLowerCase();
  const members = useMemberStore
    .getState()
    .members.filter((m) => m.status === "active");

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
        // plain includes 는 NFD 저장 이름의 한글 부분일치에 실패한다 — 전역 검색과 동일한 NFC 매처 사용
        koreanIncludes((m.name ?? "").toLowerCase(), q) ||
        koreanIncludes((m.email ?? "").toLowerCase(), q),
    )
    .slice(0, limit)
    .map(toMini);
}
