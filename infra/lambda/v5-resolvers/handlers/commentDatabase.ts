import { Buffer } from "node:buffer";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { badRequest, requireWorkspaceAccess, type Member } from "./_auth";
import type { Tables } from "./member";
import { generateNotificationsForComment } from "./notification";

type Connection<T> = { items: T[]; nextToken?: string | null };

export async function listComments(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
  updatedAfter?: string;
  limit?: number;
  nextToken?: string;
}): Promise<Connection<Record<string, unknown>>> {
  if (!args.tables.Comments) badRequest("Comments table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });
  const query = args.updatedAfter
    ? {
        expression: "workspaceId = :w AND updatedAt > :u",
        expressionValues: { ":w": args.workspaceId, ":u": args.updatedAfter },
      }
    : {
        expression: "workspaceId = :w",
        expressionValues: { ":w": args.workspaceId },
      };
  const r = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.Comments,
      IndexName: "byWorkspaceAndUpdatedAt",
      KeyConditionExpression: query.expression,
      ExpressionAttributeValues: query.expressionValues,
      Limit: args.limit ?? 2000,
      ExclusiveStartKey: args.nextToken
        ? (JSON.parse(Buffer.from(args.nextToken, "base64url").toString("utf8")) as Record<string, unknown>)
        : undefined,
    }),
  );
  return {
    items: (r.Items ?? []) as Record<string, unknown>[],
    nextToken: r.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(r.LastEvaluatedKey), "utf8").toString("base64url")
      : null,
  };
}

export async function upsertComment(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  if (!args.tables.Comments) badRequest("Comments table 미설정");
  const input = args.input;
  const workspaceId = input.workspaceId as string;
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId,
    required: "view",
  });
  const now = new Date().toISOString();
  const mentionMemberIds =
    typeof input.mentionMemberIds === "string"
      ? input.mentionMemberIds
      : JSON.stringify(input.mentionMemberIds ?? []);
  const item: Record<string, unknown> = {
    id: input.id,
    workspaceId,
    pageId: input.pageId,
    blockId: input.blockId,
    authorMemberId: input.authorMemberId ?? args.caller.memberId,
    bodyText: input.bodyText,
    mentionMemberIds,
    parentId: input.parentId ?? null,
    createdAt: (input.createdAt as string | undefined) ?? now,
    updatedAt: (input.updatedAt as string | undefined) ?? now,
  };
  await args.doc.send(new PutCommand({ TableName: args.tables.Comments, Item: item }));

  // 새 댓글에 한해 알림 생성 (updatedAt이 없거나 createdAt 기준 30초 이내)
  const createdMs = input.createdAt ? new Date(input.createdAt as string).getTime() : 0;
  const updatedMs = input.updatedAt ? new Date(input.updatedAt as string).getTime() : Date.now();
  const isNewComment = !input.updatedAt || (updatedMs - createdMs) < 30_000;
  if (isNewComment) {
    await generateNotificationsForComment({
      doc: args.doc,
      tables: args.tables,
      comment: {
        id: item.id as string,
        workspaceId: item.workspaceId as string,
        pageId: item.pageId as string,
        blockId: item.blockId as string,
        authorMemberId: item.authorMemberId as string,
        bodyText: item.bodyText as string,
        mentionMemberIds: item.mentionMemberIds as string,
      },
    });
  }

  return item;
}

export async function softDeleteComment(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  id: string;
  workspaceId: string;
  updatedAt: string;
}): Promise<Record<string, unknown>> {
  if (!args.tables.Comments) badRequest("Comments table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });
  const now = new Date().toISOString();
  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tables.Comments,
      Key: { id: args.id },
      UpdateExpression: "SET deletedAt = :d, updatedAt = :u",
      ExpressionAttributeValues: { ":d": now, ":u": args.updatedAt },
      ReturnValues: "ALL_NEW",
    }),
  );
  return (r.Attributes ?? {
    id: args.id,
    workspaceId: args.workspaceId,
    deletedAt: now,
    updatedAt: args.updatedAt,
  }) as Record<string, unknown>;
}
