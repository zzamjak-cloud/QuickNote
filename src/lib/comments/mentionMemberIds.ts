import { MENTION_MEMBER_PREFIX, hasMemberPrefix } from "../tiptapExtensions/mentionKind";

/** 멤버 멘션은 TipTap mention attrs 에서 `m:<memberId>` 로 들어온다. */
export function normalizeMentionMemberId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (hasMemberPrefix(raw)) return raw.slice(MENTION_MEMBER_PREFIX.length) || null;
  if (raw.includes(":")) return null;
  return raw;
}

export function normalizeMentionMemberIds(ids: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const normalized = normalizeMentionMemberId(id);
    if (normalized) out.add(normalized);
  }
  return [...out];
}
