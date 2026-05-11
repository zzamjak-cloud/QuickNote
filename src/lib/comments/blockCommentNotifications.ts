import type { BlockCommentMsg } from "../../types/blockComment";
import { useNotificationStore } from "../../store/notificationStore";
import { usePageStore } from "../../store/pageStore";
import { normalizeMentionMemberIds } from "./mentionMemberIds";

/** 새 글 추가 전까지의 스레드 참여자에게만 답글 알림(첫 글은 빈 배열) */
export function dispatchNotificationsForBlockCommentMessage(
  msg: BlockCommentMsg,
  priorParticipants: string[],
): void {
  const notified = new Set<string>();
  const pageTitle = usePageStore.getState().pages[msg.pageId]?.title ?? "페이지";

  for (const mid of normalizeMentionMemberIds(msg.mentionMemberIds)) {
    if (mid === msg.authorMemberId) continue;
    notified.add(mid);
    useNotificationStore.getState().addNotification({
      recipientMemberId: mid,
      kind: "mention",
      source: "comment",
      pageTitle,
      pageId: msg.pageId,
      blockId: msg.blockId,
      fromMemberId: msg.authorMemberId,
      commentId: msg.id,
      previewBody: msg.bodyText.slice(0, 140),
    });
  }

  for (const mid of priorParticipants) {
    if (mid === msg.authorMemberId) continue;
    if (notified.has(mid)) continue;
    notified.add(mid);
    useNotificationStore.getState().addNotification({
      recipientMemberId: mid,
      kind: "thread_reply",
      source: "comment",
      pageTitle,
      pageId: msg.pageId,
      blockId: msg.blockId,
      fromMemberId: msg.authorMemberId,
      commentId: msg.id,
      previewBody: msg.bodyText.slice(0, 140),
    });
  }
}

export function dispatchNewMentionNotificationsForComment(
  msg: BlockCommentMsg,
  mentionMemberIds: string[],
): void {
  const pageTitle = usePageStore.getState().pages[msg.pageId]?.title ?? "페이지";
  for (const mid of normalizeMentionMemberIds(mentionMemberIds)) {
    if (mid === msg.authorMemberId) continue;
    useNotificationStore.getState().addNotification({
      recipientMemberId: mid,
      kind: "mention",
      source: "comment",
      pageTitle,
      pageId: msg.pageId,
      blockId: msg.blockId,
      fromMemberId: msg.authorMemberId,
      commentId: msg.id,
      previewBody: msg.bodyText.slice(0, 140),
    });
  }
}
