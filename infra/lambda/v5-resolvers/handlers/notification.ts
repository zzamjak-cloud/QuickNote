import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { badRequest, type Member } from "./_auth";
import type { Tables } from "./member";

export async function listMyNotifications(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
}): Promise<Record<string, unknown>[]> {
  if (!args.tables.Notifications) return [];
  const r = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.Notifications,
      KeyConditionExpression: "recipientMemberId = :m",
      ExpressionAttributeValues: { ":m": args.caller.memberId },
      ScanIndexForward: false, // 최신순
      Limit: 200,
    }),
  );
  return (r.Items ?? []) as Record<string, unknown>[];
}

export async function markNotificationRead(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  notificationId: string;
}): Promise<Record<string, unknown>> {
  if (!args.tables.Notifications) badRequest("Notifications table 미설정");
  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tables.Notifications,
      Key: {
        recipientMemberId: args.caller.memberId,
        notificationId: args.notificationId,
      },
      UpdateExpression: "SET #r = :t",
      ExpressionAttributeNames: { "#r": "read" },
      ExpressionAttributeValues: { ":t": true },
      ReturnValues: "ALL_NEW",
    }),
  );
  return (r.Attributes ?? {
    recipientMemberId: args.caller.memberId,
    notificationId: args.notificationId,
    read: true,
  }) as Record<string, unknown>;
}

export async function deleteMyNotification(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  notificationId: string;
}): Promise<boolean> {
  if (!args.tables.Notifications) return false;
  await args.doc.send(
    new DeleteCommand({
      TableName: args.tables.Notifications,
      Key: {
        recipientMemberId: args.caller.memberId,
        notificationId: args.notificationId,
      },
    }),
  );
  return true;
}

// comment upsert 시 내부적으로 호출
export async function generateNotificationsForComment(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  comment: {
    id: string;
    workspaceId: string;
    pageId: string;
    blockId: string;
    authorMemberId: string;
    bodyText: string;
    mentionMemberIds: string; // JSON 문자열
  };
}): Promise<void> {
  if (!args.tables.Notifications) return;

  const now = new Date().toISOString();
  const expiresAt = Math.floor(Date.now() / 1000) + 90 * 24 * 3600;
  const notified = new Set<string>();

  // mentionMemberIds 파싱 (JSON 문자열 또는 배열)
  let rawMentions: string[] = [];
  try {
    const parsed =
      typeof args.comment.mentionMemberIds === "string"
        ? JSON.parse(args.comment.mentionMemberIds)
        : args.comment.mentionMemberIds;
    rawMentions = Array.isArray(parsed) ? parsed : [];
  } catch {
    rawMentions = [];
  }

  // "m:" 프리픽스 제거 및 정규화
  const mentionIds = [
    ...new Set(
      rawMentions
        .map((id) =>
          typeof id === "string" && id.startsWith("m:") ? id.slice(2) : id,
        )
        .filter(Boolean),
    ),
  ];

  const items: Record<string, unknown>[] = [];

  // 1. 멘션 알림
  for (const mid of mentionIds) {
    if (mid === args.comment.authorMemberId) continue;
    notified.add(mid);
    items.push({
      recipientMemberId: mid,
      notificationId: `${now}#${randomUUID()}`,
      workspaceId: args.comment.workspaceId,
      kind: "mention",
      source: "comment",
      fromMemberId: args.comment.authorMemberId,
      pageId: args.comment.pageId,
      blockId: args.comment.blockId,
      commentId: args.comment.id,
      previewBody: (args.comment.bodyText ?? "").slice(0, 140),
      read: false,
      createdAt: now,
      expiresAt,
    });
  }

  // 2. 스레드 답글 알림 (같은 blockId 기존 참여자)
  if (args.tables.Comments) {
    try {
      const r = await args.doc.send(
        new QueryCommand({
          TableName: args.tables.Comments,
          IndexName: "byBlockId",
          KeyConditionExpression: "blockId = :b",
          ExpressionAttributeValues: { ":b": args.comment.blockId },
          ProjectionExpression: "authorMemberId",
        }),
      );
      const priorParticipants = [
        ...new Set(
          (r.Items ?? []).map((i) => i["authorMemberId"] as string),
        ),
      ];
      for (const mid of priorParticipants) {
        if (mid === args.comment.authorMemberId) continue;
        if (notified.has(mid)) continue;
        notified.add(mid);
        items.push({
          recipientMemberId: mid,
          notificationId: `${now}#${randomUUID()}`,
          workspaceId: args.comment.workspaceId,
          kind: "thread_reply",
          source: "comment",
          fromMemberId: args.comment.authorMemberId,
          pageId: args.comment.pageId,
          blockId: args.comment.blockId,
          commentId: args.comment.id,
          previewBody: (args.comment.bodyText ?? "").slice(0, 140),
          read: false,
          createdAt: now,
          expiresAt,
        });
      }
    } catch {
      // byBlockId GSI 없으면 무시
    }
  }

  // 일괄 저장
  await Promise.all(
    items.map((item) =>
      args.doc.send(
        new PutCommand({ TableName: args.tables.Notifications!, Item: item }),
      ),
    ),
  );
}
