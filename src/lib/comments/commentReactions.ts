import type {
  BlockCommentReaction,
  BlockCommentReactionKind,
} from "../../types/blockComment";

export type CommentReactionTarget = {
  kind: BlockCommentReactionKind;
  value: string;
};

export type CommentReactionToggleResult = {
  reactions: BlockCommentReaction[];
  reacted: boolean;
};

function normalizeReactionKind(value: unknown): BlockCommentReactionKind | null {
  return value === "emoji" || value === "custom" ? value : null;
}

export function reactionKey(target: CommentReactionTarget): string {
  return `${target.kind}:${target.value}`;
}

export function normalizeCommentReactionTarget(
  value: unknown,
): CommentReactionTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const kind = normalizeReactionKind(raw.kind);
  const reactionValue = typeof raw.value === "string" ? raw.value.trim() : "";
  if (!kind || !reactionValue) return null;
  return { kind, value: reactionValue };
}

export function normalizeCommentReactions(value: unknown): BlockCommentReaction[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, BlockCommentReaction>();

  for (const raw of value) {
    const target = normalizeCommentReactionTarget(raw);
    if (!target || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const memberIdsRaw = (raw as Record<string, unknown>).memberIds;
    const memberIds = Array.isArray(memberIdsRaw)
      ? Array.from(
          new Set(
            memberIdsRaw
              .filter((memberId): memberId is string => typeof memberId === "string")
              .map((memberId) => memberId.trim())
              .filter(Boolean),
          ),
        )
      : [];
    if (memberIds.length === 0) continue;

    const key = reactionKey(target);
    const previous = byKey.get(key);
    if (previous) {
      byKey.set(key, {
        ...previous,
        memberIds: Array.from(new Set([...previous.memberIds, ...memberIds])),
      });
    } else {
      byKey.set(key, { ...target, memberIds });
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const kindOrder = a.kind.localeCompare(b.kind);
    return kindOrder || a.value.localeCompare(b.value);
  });
}

export function toggleCommentReaction(
  reactions: unknown,
  target: CommentReactionTarget,
  memberId: string,
): CommentReactionToggleResult {
  const normalizedMemberId = memberId.trim();
  if (!normalizedMemberId) {
    return { reactions: normalizeCommentReactions(reactions), reacted: false };
  }

  const next = normalizeCommentReactions(reactions);
  const key = reactionKey(target);
  const index = next.findIndex((reaction) => reactionKey(reaction) === key);

  if (index === -1) {
    return {
      reactions: [...next, { ...target, memberIds: [normalizedMemberId] }],
      reacted: true,
    };
  }

  const current = next[index];
  if (!current) {
    return { reactions: next, reacted: false };
  }
  const hadMember = current.memberIds.includes(normalizedMemberId);
  const memberIds = hadMember
    ? current.memberIds.filter((id) => id !== normalizedMemberId)
    : [...current.memberIds, normalizedMemberId];

  if (memberIds.length === 0) {
    next.splice(index, 1);
  } else {
    next[index] = { ...current, memberIds };
  }

  return { reactions: next, reacted: !hadMember };
}
