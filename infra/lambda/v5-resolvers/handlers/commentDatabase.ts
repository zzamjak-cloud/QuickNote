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
type CommentReactionKind = "emoji" | "custom";
type CommentReaction = {
  kind: CommentReactionKind;
  value: string;
  memberIds: string[];
};

const MAX_REACTION_UPDATE_ATTEMPTS = 5;

function parseJsonArray(value: unknown): unknown[] {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value : [];
}

function normalizeReactionKind(value: unknown): CommentReactionKind | null {
  return value === "emoji" || value === "custom" ? value : null;
}

function normalizeReactions(value: unknown): CommentReaction[] {
  const byKey = new Map<string, CommentReaction>();
  for (const raw of parseJsonArray(value)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const kind = normalizeReactionKind(record.kind);
    const reactionValue = typeof record.value === "string" ? record.value.trim() : "";
    if (!kind || !reactionValue) continue;
    const memberIds = Array.from(
      new Set(
        (Array.isArray(record.memberIds) ? record.memberIds : [])
          .filter((memberId): memberId is string => typeof memberId === "string")
          .map((memberId) => memberId.trim())
          .filter(Boolean),
      ),
    );
    if (memberIds.length === 0) continue;
    const key = `${kind}:${reactionValue}`;
    const previous = byKey.get(key);
    byKey.set(key, {
      kind,
      value: reactionValue,
      memberIds: previous
        ? Array.from(new Set([...previous.memberIds, ...memberIds]))
        : memberIds,
    });
  }
  return Array.from(byKey.values()).sort((a, b) => {
    const kindOrder = a.kind.localeCompare(b.kind);
    return kindOrder || a.value.localeCompare(b.value);
  });
}

function applyReactionIntent(args: {
  reactions: unknown;
  kind: CommentReactionKind;
  value: string;
  memberId: string;
  reacted: boolean;
}): CommentReaction[] {
  const next = normalizeReactions(args.reactions);
  const key = `${args.kind}:${args.value}`;
  const index = next.findIndex((reaction) => `${reaction.kind}:${reaction.value}` === key);
  if (index === -1) {
    return args.reacted
      ? [...next, { kind: args.kind, value: args.value, memberIds: [args.memberId] }]
      : next;
  }

  const current = next[index];
  const memberIds = args.reacted
    ? Array.from(new Set([...current.memberIds, args.memberId]))
    : current.memberIds.filter((memberId) => memberId !== args.memberId);
  if (memberIds.length === 0) {
    next.splice(index, 1);
  } else {
    next[index] = { ...current, memberIds };
  }
  return next;
}

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
  const reactions = JSON.stringify(normalizeReactions(input.reactions ?? []));
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
    reactions,
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

export async function toggleCommentReaction(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  if (!args.tables.Comments) badRequest("Comments table 미설정");
  const input = args.input;
  const id = typeof input.id === "string" ? input.id : "";
  const workspaceId = typeof input.workspaceId === "string" ? input.workspaceId : "";
  const kind = normalizeReactionKind(input.reactionKind);
  const reactionValue = typeof input.reactionValue === "string" ? input.reactionValue.trim() : "";
  const reacted = input.reacted === true;
  if (!id || !workspaceId || !kind || !reactionValue) {
    badRequest("댓글 반응 입력값이 올바르지 않습니다");
  }

  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId,
    required: "view",
  });

  for (let attempt = 0; attempt < MAX_REACTION_UPDATE_ATTEMPTS; attempt += 1) {
    const existing = await args.doc.send(
      new GetCommand({
        TableName: args.tables.Comments,
        Key: { id },
      }),
    );
    const item = existing.Item as Record<string, unknown> | undefined;
    if (!item) badRequest("댓글을 찾을 수 없습니다");
    if (item.workspaceId !== workspaceId) {
      forbidden("다른 워크스페이스의 댓글 반응은 수정할 수 없습니다");
    }
    if (item.deletedAt) badRequest("삭제된 댓글에는 반응할 수 없습니다");

    const previousUpdatedAt =
      typeof item.updatedAt === "string" ? item.updatedAt : new Date(0).toISOString();
    const updatedAt =
      attempt === 0 && typeof input.updatedAt === "string"
        ? input.updatedAt
        : new Date().toISOString();
    const reactions = JSON.stringify(
      applyReactionIntent({
        reactions: item.reactions,
        kind,
        value: reactionValue,
        memberId: args.caller.memberId,
        reacted,
      }),
    );

    try {
      const updated = await args.doc.send(
        new UpdateCommand({
          TableName: args.tables.Comments,
          Key: { id },
          UpdateExpression: "SET reactions = :r, updatedAt = :u",
          ConditionExpression:
            "workspaceId = :w AND updatedAt = :prev AND attribute_not_exists(deletedAt)",
          ExpressionAttributeValues: {
            ":r": reactions,
            ":u": updatedAt,
            ":w": workspaceId,
            ":prev": previousUpdatedAt,
          },
          ReturnValues: "ALL_NEW",
        }),
      );
      return (updated.Attributes ?? { ...item, reactions, updatedAt }) as Record<string, unknown>;
    } catch (err) {
      if ((err as { name?: string })?.name === "ConditionalCheckFailedException") {
        if (attempt < MAX_REACTION_UPDATE_ATTEMPTS - 1) continue;
        badRequest("댓글 반응 갱신 충돌이 반복되었습니다. 잠시 후 다시 시도해 주세요");
      }
      throw err;
    }
  }

  badRequest("댓글 반응 갱신에 실패했습니다");
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
