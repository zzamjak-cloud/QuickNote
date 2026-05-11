import type { BlockCommentMsg, PageBlockCommentsSnapshot } from "../../types/blockComment";
import { normalizeMentionMemberIds } from "./mentionMemberIds";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** persist / 원격 JSON 에서 단일 메시지 복원 */
export function migrateBlockCommentMsg(value: unknown): BlockCommentMsg | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const msg = value as Partial<BlockCommentMsg>;
  if (
    typeof msg.id !== "string" ||
    typeof msg.pageId !== "string" ||
    typeof msg.blockId !== "string" ||
    typeof msg.authorMemberId !== "string"
  ) {
    return null;
  }
  return {
    id: msg.id,
    workspaceId: msg.workspaceId ?? null,
    pageId: msg.pageId,
    blockId: msg.blockId,
    authorMemberId: msg.authorMemberId,
    bodyText: typeof msg.bodyText === "string" ? msg.bodyText : "",
    mentionMemberIds: normalizeMentionMemberIds(msg.mentionMemberIds ?? []),
    parentId: typeof msg.parentId === "string" ? msg.parentId : null,
    createdAt: typeof msg.createdAt === "number" ? msg.createdAt : Date.now(),
  };
}

export function migrateThreadVisitedAt(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const timestamp = Number(raw);
    if (key && Number.isFinite(timestamp) && timestamp > 0) {
      result[key] = timestamp;
    }
  }
  return result;
}

/** unknown → 페이지에 넣을 스냅샷(실패 시 undefined) */
export function coercePageBlockComments(value: unknown): PageBlockCommentsSnapshot | undefined {
  if (value == null) return undefined;
  if (!isPlainObject(value)) return undefined;
  const messagesRaw = value.messages;
  if (!Array.isArray(messagesRaw)) return undefined;
  const messages = messagesRaw
    .map(migrateBlockCommentMsg)
    .filter((m): m is BlockCommentMsg => m != null);
  return {
    messages,
    threadVisitedAt: migrateThreadVisitedAt(value.threadVisitedAt),
  };
}

/** 새 메시지 직전까지 동일 스레드에 참여한 작성자 id (멘션 알림 보조) */
export function priorParticipantIdsForNewMessage(
  messages: BlockCommentMsg[],
  pageId: string,
  blockId: string,
  newMsg: BlockCommentMsg,
): string[] {
  const ids = new Set<string>();
  for (const m of messages) {
    if (m.pageId !== pageId || m.blockId !== blockId) continue;
    if (m.id === newMsg.id) continue;
    if (
      m.createdAt < newMsg.createdAt ||
      (m.createdAt === newMsg.createdAt && m.id < newMsg.id)
    ) {
      ids.add(m.authorMemberId);
    }
  }
  return [...ids];
}
