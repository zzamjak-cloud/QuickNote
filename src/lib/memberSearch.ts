export type MemberSearchTarget = {
  name: string;
  email?: string | null;
  jobRole?: string | null;
  jobTitle?: string | null;
};

const CHOSEONG_LIST = [
  "ㄱ",
  "ㄲ",
  "ㄴ",
  "ㄷ",
  "ㄸ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅃ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅉ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
];

function normalizeSearchText(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

function compactSearchText(value: string): string {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

function toChoseongText(value: string): string {
  return [...normalizeSearchText(value)]
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code >= 0xac00 && code <= 0xd7a3) {
        const index = Math.floor((code - 0xac00) / 588);
        return CHOSEONG_LIST[index] ?? char;
      }
      return char;
    })
    .join("");
}

export function matchesMemberSearchQuery(
  member: MemberSearchTarget,
  rawQuery: string,
): boolean {
  const query = rawQuery.trim();
  if (!query) return true;

  const normalizedQuery = normalizeSearchText(query);
  const normalizedCompactQuery = compactSearchText(query);
  const fields = [
    member.name,
    member.email ?? "",
    member.jobRole ?? "",
    member.jobTitle ?? "",
  ];
  const normalizedFields = fields.map((text) => normalizeSearchText(text));

  if (normalizedFields.some((text) => text.includes(normalizedQuery))) {
    return true;
  }

  if (
    normalizedCompactQuery.length > 0 &&
    normalizedFields
      .map((text) => text.replace(/\s+/g, ""))
      .some((text) => text.includes(normalizedCompactQuery))
  ) {
    return true;
  }

  const choseongQuery = toChoseongText(query);
  if (!choseongQuery) return false;
  return toChoseongText(member.name).includes(choseongQuery);
}

export function sortByKoreanName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

