import { Buffer } from "node:buffer";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

/** 휴지통 보관 기간 — listTrashedPages / restorePage / 만료 영구삭제와 동일하게 유지 */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const TRASH_PAGE_MAX = 50;

/** DynamoDB Query 연속 조회 커서(EK + 동일 페이지 배열 내 skip) */
type TrashListCursor = {
  ek?: Record<string, unknown>;
  skip: number;
};

function encodeTrashCursor(c: TrashListCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeTrashCursor(s: string | null | undefined): TrashListCursor | null {
  if (!s) return null;
  try {
    const o = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as {
      ek?: Record<string, unknown>;
      skip?: number;
    };
    const skip = typeof o.skip === "number" && o.skip >= 0 ? o.skip : 0;
    return { ek: o.ek, skip };
  } catch {
    return null;
  }
}
import { badRequest, notFound, requireWorkspaceAccess, type Member } from "./_auth";
import type { Tables } from "./member";

type Connection<T> = { items: T[]; nextToken?: string | null };

type BaseRecord = {
  id: string;
  workspaceId: string;
  createdByMemberId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export async function listPages(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
  updatedAfter?: string;
  limit?: number;
  nextToken?: string;
}): Promise<Connection<Record<string, unknown>>> {
  if (!args.tables.Pages) badRequest("Pages table 미설정");
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
      TableName: args.tables.Pages,
      IndexName: "byWorkspaceAndUpdatedAt",
      KeyConditionExpression: query.expression,
      ExpressionAttributeValues: query.expressionValues,
      Limit: args.limit ?? 100,
      ExclusiveStartKey: args.nextToken ? JSON.parse(args.nextToken) : undefined,
    }),
  );
  return {
    items: (r.Items ?? []) as Record<string, unknown>[],
    nextToken: r.LastEvaluatedKey ? JSON.stringify(r.LastEvaluatedKey) : null,
  };
}

export async function listDatabases(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
  updatedAfter?: string;
  limit?: number;
  nextToken?: string;
}): Promise<Connection<Record<string, unknown>>> {
  if (!args.tables.Databases) badRequest("Databases table 미설정");
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
      TableName: args.tables.Databases,
      IndexName: "byWorkspaceAndUpdatedAt",
      KeyConditionExpression: query.expression,
      ExpressionAttributeValues: query.expressionValues,
      Limit: args.limit ?? 100,
      ExclusiveStartKey: args.nextToken ? JSON.parse(args.nextToken) : undefined,
    }),
  );
  return {
    items: (r.Items ?? []) as Record<string, unknown>[],
    nextToken: r.LastEvaluatedKey ? JSON.stringify(r.LastEvaluatedKey) : null,
  };
}

async function upsertRecord(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  tableName: string;
  input: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const input = args.input as unknown as BaseRecord;
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: input.workspaceId,
    required: "edit",
  });
  await args.doc.send(
    new PutCommand({
      TableName: args.tableName,
      Item: {
        ...args.input,
        createdByMemberId: input.createdByMemberId || args.caller.memberId,
      },
    }),
  );
  return args.input;
}

export async function upsertPage(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  if (!args.tables.Pages) badRequest("Pages table 미설정");
  return upsertRecord({ ...args, tableName: args.tables.Pages });
}

export async function upsertDatabase(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  if (!args.tables.Databases) badRequest("Databases table 미설정");
  return upsertRecord({ ...args, tableName: args.tables.Databases });
}

async function softDeleteRecord(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  tableName: string;
  id: string;
  workspaceId: string;
  updatedAt: string;
}): Promise<Record<string, unknown>> {
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "edit",
  });
  const existing = await args.doc.send(
    new GetCommand({ TableName: args.tableName, Key: { id: args.id } }),
  );
  if (!existing.Item) notFound("리소스 없음");
  const now = new Date().toISOString();
  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tableName,
      Key: { id: args.id },
      UpdateExpression: "SET deletedAt = :d, updatedAt = :u",
      ExpressionAttributeValues: {
        ":d": now,
        ":u": now,
        ":old": args.updatedAt,
        ":w": args.workspaceId,
      },
      ConditionExpression: "workspaceId = :w AND (attribute_not_exists(updatedAt) OR updatedAt <= :old)",
      ReturnValues: "ALL_NEW",
    }),
  );
  return (r.Attributes ?? {}) as Record<string, unknown>;
}

export async function softDeletePage(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  id: string;
  workspaceId: string;
  updatedAt: string;
}): Promise<Record<string, unknown>> {
  if (!args.tables.Pages) badRequest("Pages table 미설정");
  return softDeleteRecord({ ...args, tableName: args.tables.Pages });
}

export async function softDeleteDatabase(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  id: string;
  workspaceId: string;
  updatedAt: string;
}): Promise<Record<string, unknown>> {
  if (!args.tables.Databases) badRequest("Databases table 미설정");
  return softDeleteRecord({ ...args, tableName: args.tables.Databases });
}

/** 삭제됐지만 보관 기간 내인 페이지만, 삭제 시각 최신순 정렬·페이지당 최대 TRASH_PAGE_MAX 건 */
export async function listTrashedPages(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
  limit?: number;
  nextToken?: string | null;
}): Promise<Connection<Record<string, unknown>>> {
  if (!args.tables.Pages) badRequest("Pages table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });
  const cutoffIso = new Date(Date.now() - TRASH_RETENTION_MS).toISOString();
  const pageSize = Math.min(Math.max(args.limit ?? TRASH_PAGE_MAX, 1), TRASH_PAGE_MAX);
  const parsed = decodeTrashCursor(args.nextToken ?? undefined);
  const collected: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined = parsed?.ek;
  let itemSkip = parsed?.skip ?? 0;

  let iterations = 0;
  while (collected.length < pageSize && iterations < 100) {
    iterations += 1;
    const queryStartKey = exclusiveStartKey;
    const r = await args.doc.send(
      new QueryCommand({
        TableName: args.tables.Pages,
        IndexName: "byWorkspaceAndUpdatedAt",
        KeyConditionExpression: "workspaceId = :w",
        ExpressionAttributeValues: {
          ":w": args.workspaceId,
          ":cutoff": cutoffIso,
        },
        FilterExpression:
          "attribute_exists(deletedAt) AND deletedAt > :cutoff",
        Limit: 100,
        ScanIndexForward: false,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    const batch = (r.Items ?? []) as Record<string, unknown>[];
    let i = itemSkip;
    itemSkip = 0;
    for (; i < batch.length && collected.length < pageSize; i++) {
      collected.push(batch[i]!);
    }
    if (collected.length >= pageSize) {
      collected.sort((a, b) =>
        String(b["deletedAt"] ?? "").localeCompare(String(a["deletedAt"] ?? "")),
      );
      let nextTok: string | null = null;
      if (i < batch.length) {
        nextTok = encodeTrashCursor({ ek: queryStartKey, skip: i });
      } else if (r.LastEvaluatedKey) {
        nextTok = encodeTrashCursor({
          ek: r.LastEvaluatedKey as Record<string, unknown>,
          skip: 0,
        });
      }
      return { items: collected, nextToken: nextTok };
    }
    if (!r.LastEvaluatedKey) {
      collected.sort((a, b) =>
        String(b["deletedAt"] ?? "").localeCompare(String(a["deletedAt"] ?? "")),
      );
      return { items: collected, nextToken: null };
    }
    exclusiveStartKey = r.LastEvaluatedKey as Record<string, unknown>;
  }
  collected.sort((a, b) =>
    String(b["deletedAt"] ?? "").localeCompare(String(a["deletedAt"] ?? "")),
  );
  return { items: collected, nextToken: null };
}

export async function restorePage(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  id: string;
  workspaceId: string;
}): Promise<Record<string, unknown>> {
  if (!args.tables.Pages) badRequest("Pages table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "edit",
  });
  const existing = await args.doc.send(
    new GetCommand({
      TableName: args.tables.Pages,
      Key: { id: args.id },
    }),
  );
  const item = existing.Item as Record<string, unknown> | undefined;
  if (!item) notFound("페이지 없음");
  if (String(item["workspaceId"]) !== args.workspaceId) {
    badRequest("워크스페이스가 일치하지 않습니다");
  }
  if (item["deletedAt"] == null || item["deletedAt"] === "") {
    badRequest("삭제되지 않은 페이지입니다");
  }
  const deletedMs = Date.parse(String(item["deletedAt"]));
  if (Number.isNaN(deletedMs)) badRequest("삭제 일시가 올바르지 않습니다");
  if (deletedMs < Date.now() - TRASH_RETENTION_MS) {
    badRequest("보관 기간이 지나 복원할 수 없습니다");
  }
  const next: Record<string, unknown> = { ...item };
  delete next["deletedAt"];
  next["updatedAt"] = new Date().toISOString();
  await args.doc.send(
    new PutCommand({
      TableName: args.tables.Pages,
      Item: next,
    }),
  );
  return next;
}

export async function validateWorkspaceSubscription(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
}): Promise<null> {
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });
  return null;
}
