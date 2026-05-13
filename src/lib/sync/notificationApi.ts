import { appsyncClient } from "./graphql/client";
import {
  LIST_MY_NOTIFICATIONS,
  MARK_NOTIFICATION_READ,
  DELETE_MY_NOTIFICATION,
} from "./queries/notification";
import type { InAppNotification } from "../../store/notificationStore";

type RawNotification = {
  notificationId: string;
  workspaceId: string;
  recipientMemberId: string;
  kind: string;
  source?: string;
  fromMemberId: string;
  pageId: string;
  blockId: string;
  commentId: string;
  previewBody?: string;
  workspaceName?: string;
  pageTitle?: string;
  read: boolean;
  createdAt: string;
};

type ListMyNotificationsResponse = {
  data?: {
    listMyNotifications?: RawNotification[];
  };
};

type MarkNotificationReadResponse = {
  data?: {
    markNotificationRead?: { notificationId: string; read: boolean };
  };
};

type DeleteMyNotificationResponse = {
  data?: {
    deleteMyNotification?: string;
  };
};

function rawToInApp(raw: RawNotification): InAppNotification {
  return {
    id: raw.notificationId,
    recipientMemberId: raw.recipientMemberId,
    kind: raw.kind as InAppNotification["kind"],
    source: (raw.source as InAppNotification["source"]) ?? "comment",
    workspaceId: raw.workspaceId ?? null,
    workspaceName: raw.workspaceName ?? null,
    pageTitle: raw.pageTitle ?? null,
    pageId: raw.pageId,
    blockId: raw.blockId,
    fromMemberId: raw.fromMemberId,
    commentId: raw.commentId,
    previewBody: raw.previewBody ?? "",
    createdAt: new Date(raw.createdAt).getTime(),
    read: raw.read,
  };
}

/** 서버에서 내 알림 목록을 전량 조회한다. */
export async function fetchMyNotificationsApi(): Promise<InAppNotification[]> {
  const res = (await appsyncClient().graphql({
    query: LIST_MY_NOTIFICATIONS,
  })) as ListMyNotificationsResponse;
  return (res.data?.listMyNotifications ?? []).map(rawToInApp);
}

/** 특정 알림을 읽음으로 표시한다. */
export async function markNotificationReadApi(notificationId: string): Promise<void> {
  await (appsyncClient().graphql({
    query: MARK_NOTIFICATION_READ,
    variables: { notificationId },
  }) as Promise<MarkNotificationReadResponse>);
}

/** 내 알림을 삭제한다. */
export async function deleteMyNotificationApi(notificationId: string): Promise<void> {
  await (appsyncClient().graphql({
    query: DELETE_MY_NOTIFICATION,
    variables: { notificationId },
  }) as Promise<DeleteMyNotificationResponse>);
}
