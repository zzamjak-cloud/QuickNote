import type { Member } from "../../../store/memberStore";

const ORG_LEADER_KEYWORDS = ["실장", "부실장", "본부장", "센터장", "조직장"];
const TEAM_LEADER_KEYWORDS = ["팀장", "부팀장", "파트장", "팀리더", "리드"];
const PROJECT_LEADER_KEYWORDS = ["프로젝트장", "PM", "PL", "리더", "Lead"];

export type LeaderScopeKind = "organization" | "team" | "project";

function hasKeyword(member: Member, keywords: string[]): boolean {
  const text = `${member.jobTitle ?? ""} ${member.jobRole ?? ""}`.toLowerCase();
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

export function inferLeaderMemberIds(kind: LeaderScopeKind, members: Member[]): string[] {
  const keywords = kind === "organization"
    ? ORG_LEADER_KEYWORDS
    : kind === "team"
      ? TEAM_LEADER_KEYWORDS
      : PROJECT_LEADER_KEYWORDS;
  return members
    .filter((member) => member.status === "active" && hasKeyword(member, keywords))
    .map((member) => member.memberId);
}
