import type { Member } from "../../store/memberStore";

export function normalizeImportedPersonName(raw: string): string {
  // member.name 은 타입상 string 이나 런타임 nullish 가능(멤버 필드 크래시 패밀리) → 방어
  if (typeof raw !== "string") return "";
  // NFC 정규화 필수 — 노션/맥OS 내보내기 작성자명은 분해형(NFD)이라 조합형(NFC) 멤버명과
  // === 비교에서 불일치해 매칭 실패→작성자 fallback(임포터 계정)으로 떨어졌다. 한글 NFD/NFC 패밀리.
  const trimmed = raw.normalize("NFC").trim();
  if (!trimmed) return "";
  const base = trimmed.split("[")[0]?.trim() ?? trimmed;
  return base.replace(/\s+/g, "");
}

export function splitPersonTokens(raw: string): string[] {
  const parts = raw
    .split(/[;,/|]/)
    .map((s) => normalizeImportedPersonName(s))
    .filter(Boolean);
  return Array.from(new Set(parts));
}

export function resolveImportedPersonMemberId(
  rawName: string,
  members: Member[],
  fallbackMemberId: string,
): string {
  const rawAuthor = normalizeImportedPersonName(rawName);
  // 노션 작성자 예외 매핑 (실서비스 데이터 기준)
  const aliasMap: Record<string, string> = {
    "다은": "이다은",
  };
  const normalizedAuthor = normalizeImportedPersonName(aliasMap[rawAuthor] ?? rawAuthor);
  if (!normalizedAuthor) return fallbackMemberId;

  const normalizedMembers = members.map((member) => ({
    memberId: member.memberId,
    status: member.status,
    name: normalizeImportedPersonName(member.name),
  }));

  const stripTrailingNumber = (value: string): string => value.replace(/\d+$/, "");
  const lastTwo = (value: string): string => (value.length >= 2 ? value.slice(-2) : value);
  const authorBase = stripTrailingNumber(normalizedAuthor);
  const authorGiven = lastTwo(authorBase);

  const exact =
    normalizedMembers.find((m) => m.name === normalizedAuthor && m.status === "active")
    ?? normalizedMembers.find((m) => m.name === normalizedAuthor);
  if (exact) return exact.memberId;

  const baseExact =
    normalizedMembers.find((m) => stripTrailingNumber(m.name) === authorBase && m.status === "active")
    ?? normalizedMembers.find((m) => stripTrailingNumber(m.name) === authorBase);
  if (baseExact) return baseExact.memberId;

  const givenCandidates = normalizedMembers.filter((m) => lastTwo(stripTrailingNumber(m.name)) === authorGiven);
  if (givenCandidates.length === 1) return givenCandidates[0]?.memberId ?? fallbackMemberId;
  const activeGivenCandidates = givenCandidates.filter((m) => m.status === "active");
  if (activeGivenCandidates.length === 1) return activeGivenCandidates[0]?.memberId ?? fallbackMemberId;

  return fallbackMemberId;
}

