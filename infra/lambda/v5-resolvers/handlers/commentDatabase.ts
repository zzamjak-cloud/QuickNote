import { Buffer } from "node:buffer";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { badRequest, forbidden, requireWorkspaceAccess, type Member } from "./_auth";
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
  // 작성자 스푸핑 방지: 기본은 항상 호출자로 강제한다.
  // 단, 가져오기(노션 등)로 원본 작성자를 보존하려는 경우(importedAuthorMemberId 지정)에 한해,
  // 그 id 가 실제로 존재하는(removed 아님) 구성원일 때만 작성자로 허용한다. 존재하지 않으면 호출자 강제.
  // (구성원 자격은 org 단위 Members 테이블 기준 — listMembers 와 동일한 권위 정의)
  let authorMemberId = args.caller.memberId;
  const requestedAuthor =
    typeof input.importedAuthorMemberId === "string" ? input.importedAuthorMemberId : null;
  if (requestedAuthor && requestedAuthor !== args.caller.memberId && args.tables.Members) {
    const found = await args.doc.send(
      new GetCommand({
        TableName: args.tables.Members,
        Key: { memberId: requestedAuthor },
      }),
    );
    const status = (found.Item as { status?: string } | undefined)?.status;
    if (found.Item && status !== "removed") {
      authorMemberId = requestedAuthor;
    }
  }
  const item: Record<string, unknown> = {
    id: input.id,
    workspaceId,
    pageId: input.pageId,
    blockId: input.blockId,
    authorMemberId,
    bodyText: input.bodyText,
    mentionMemberIds,
    parentId: input.parentId ?? null,
    createdAt: (input.createdAt as string | undefined) ?? now,
    updatedAt: (input.updatedAt as string | undefined) ?? now,
  };
  // 교차 워크스페이스 덮어쓰기(IDOR) 차단: id 단독 PK 이므로 신규이거나 기존 댓글의
  // workspaceId 가 호출자가 권한 검증한 workspaceId 와 일치할 때만 Put 을 허용한다.
  try {
    await args.doc.send(
      new PutCommand({
        TableName: args.tables.Comments,
        Item: item,
        ConditionExpression: "attribute_not_exists(id) OR workspaceId = :w",
        ExpressionAttributeValues: { ":w": workspaceId },
      }),
    );
  } catch (err) {
    if ((err as { name?: string })?.name === "ConditionalCheckFailedException") {
      forbidden("다른 워크스페이스의 댓글은 수정할 수 없습니다");
    }
    throw err;
  }

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
  // 교차 워크스페이스 삭제(IDOR) 차단: 대상 댓글의 실제 workspaceId 가 호출자가 권한 검증한
  // workspaceId 와 일치할 때만 soft delete 를 허용한다. (id 만으로 임의 댓글 삭제 방지)
  let r;
  try {
    r = await args.doc.send(
      new UpdateCommand({
        TableName: args.tables.Comments,
        Key: { id: args.id },
        UpdateExpression: "SET deletedAt = :d, updatedAt = :u",
        ConditionExpression: "workspaceId = :w",
        ExpressionAttributeValues: { ":d": now, ":u": args.updatedAt, ":w": args.workspaceId },
        ReturnValues: "ALL_NEW",
      }),
    );
  } catch (err) {
    if ((err as { name?: string })?.name === "ConditionalCheckFailedException") {
      forbidden("다른 워크스페이스의 댓글은 삭제할 수 없습니다");
    }
    throw err;
  }
  return (r.Attributes ?? {
    id: args.id,
    workspaceId: args.workspaceId,
    deletedAt: now,
    updatedAt: args.updatedAt,
  }) as Record<string, unknown>;
}
