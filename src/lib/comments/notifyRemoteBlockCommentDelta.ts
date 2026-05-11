import type { PageBlockCommentsSnapshot } from "../../types/blockComment";
import { priorParticipantIdsForNewMessage } from "./blockCommentSnapshot";
import { dispatchNotificationsForBlockCommentMessage } from "./blockCommentNotifications";
import { usePageStore } from "../../store/pageStore";

/**
 * 구독/페치로 페이지 댓글 스냅샷이 갱신될 때, 새로 생긴 메시지에 대해 로컬 알림을 보낸다.
 * 본인이 작성한 메시지의 에코(다른 기기·탭)는 제외해 중복 알림을 막는다.
 */
export function notifyRemoteBlockCommentDelta(
  myMemberId: string | undefined,
  prev: PageBlockCommentsSnapshot | undefined,
  next: PageBlockCommentsSnapshot | undefined,
): void {
  if (!next?.messages?.length) return;
  const prevIds = new Set((prev?.messages ?? []).map((m) => m.id));
  for (const msg of next.messages) {
    if (prevIds.has(msg.id)) continue;
    if (myMemberId && msg.authorMemberId === myMemberId) continue;
    const prior = priorParticipantIdsForNewMessage(next.messages, msg.pageId, msg.blockId, msg);
    const pageOwner = usePageStore.getState().pages[msg.pageId]?.createdByMemberId;
    dispatchNotificationsForBlockCommentMessage(msg, prior, pageOwner);
  }
}
