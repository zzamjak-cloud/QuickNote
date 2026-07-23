// 원격 Comment 엔티티를 blockCommentStore 에 LWW 적용하는 reducer.
// storeApply.ts 에서 분리(behavior-preserving). 워크스페이스 가드는 storeApply 의
// shouldApplyRemoteSnapshot 를 공유한다.
import type { GqlComment } from "../queries/comment";
import type { BlockCommentMsg } from "../../../types/blockComment";
import { useBlockCommentStore } from "../../../store/blockCommentStore";
import { isoToMs, parseAwsJson } from "./helpers";
import { shouldApplyRemoteSnapshot } from "../storeApply";
import { normalizeCommentReactions } from "../../comments/commentReactions";

// 페이지 댓글 sentinel (PageCommentBar 와 동일 값 유지)
const PAGE_COMMENT_SENTINEL = "__page__";

/** blockId/pageId 유효성 검사 — 빈 문자열·whitespace 는 거부 */
function isValidCommentId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.trim().length > 0;
}

/** 원격 Comment 엔티티를 blockCommentStore 에 LWW 적용 */
export function applyRemoteCommentToStore(
  c: GqlComment | null | undefined,
): void {
  if (!c) return;
  if (!shouldApplyRemoteSnapshot(c.workspaceId)) return;

  // 손상된 페이로드 방어: pageId 와 blockId 가 유효해야 적용
  if (!isValidCommentId(c.pageId)) {
    console.warn("[sync] applyRemoteCommentToStore: pageId 누락 — 무시", c.id);
    return;
  }
  if (!isValidCommentId(c.blockId) && c.blockId !== PAGE_COMMENT_SENTINEL) {
    console.warn("[sync] applyRemoteCommentToStore: blockId 누락 — 무시", c.id);
    return;
  }

  const mentionMemberIds = parseAwsJson<string[]>(c.mentionMemberIds, []);
  const reactions = normalizeCommentReactions(parseAwsJson<unknown>(c.reactions, []));

  if (c.deletedAt) {
    useBlockCommentStore.getState().removeMessage(c.id);
    return;
  }

  const msg: BlockCommentMsg = {
    id: c.id,
    workspaceId: c.workspaceId,
    pageId: c.pageId,
    blockId: c.blockId,
    authorMemberId: c.authorMemberId,
    bodyText: c.bodyText,
    mentionMemberIds,
    reactions,
    parentId: c.parentId ?? null,
    createdAt: isoToMs(c.createdAt) || Date.now(),
  };

  useBlockCommentStore.getState().applyRemoteMessage(msg);
}

export function applyRemoteCommentsToStore(
  comments: Array<GqlComment | null | undefined>,
): void {
  if (comments.length === 0) return;
  const upserts: BlockCommentMsg[] = [];
  const deletes = new Set<string>();

  for (const c of comments) {
    if (!c) continue;
    if (!shouldApplyRemoteSnapshot(c.workspaceId)) continue;
    if (!isValidCommentId(c.pageId)) {
      console.warn("[sync] applyRemoteCommentsToStore: pageId 누락 — 무시", c.id);
      continue;
    }
    if (!isValidCommentId(c.blockId) && c.blockId !== PAGE_COMMENT_SENTINEL) {
      console.warn("[sync] applyRemoteCommentsToStore: blockId 누락 — 무시", c.id);
      continue;
    }
    if (c.deletedAt) {
      deletes.add(c.id);
      continue;
    }
    upserts.push({
      id: c.id,
      workspaceId: c.workspaceId,
      pageId: c.pageId,
      blockId: c.blockId,
      authorMemberId: c.authorMemberId,
      bodyText: c.bodyText,
      mentionMemberIds: parseAwsJson<string[]>(c.mentionMemberIds, []),
      reactions: normalizeCommentReactions(parseAwsJson<unknown>(c.reactions, [])),
      parentId: c.parentId ?? null,
      createdAt: isoToMs(c.createdAt) || Date.now(),
    });
  }

  if (upserts.length === 0 && deletes.size === 0) return;

  useBlockCommentStore.setState((s) => {
    const byId = new Map(s.messages.map((message) => [message.id, message]));
    // 실제 변경 여부를 먼저 판정해 변경이 없으면 배열 재구성을 건너뛴다.
    // (삭제 대상이 실제 존재하거나, upsert 가 기존 참조와 다를 때만 변경으로 본다.)
    let changed = false;
    for (const id of deletes) {
      if (byId.delete(id)) changed = true;
    }
    for (const msg of upserts) {
      if (byId.get(msg.id) !== msg) {
        byId.set(msg.id, msg);
        changed = true;
      }
    }
    if (!changed) return s;
    const messages = Array.from(byId.values());
    if (messages.length === s.messages.length) {
      let same = true;
      for (let i = 0; i < messages.length; i += 1) {
        if (messages[i] !== s.messages[i]) {
          same = false;
          break;
        }
      }
      if (same) return s;
    }
    return { ...s, messages };
  });
}
