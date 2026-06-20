import { Buffer } from "node:buffer";
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  badRequest,
  forbidden,
  isLCSchedulerDatabaseId,
  notFound,
  requireWorkspaceAccess,
  type Member,
} from "../_auth";
import type { Tables } from "../member";
import { cascadeDeletePageAssetUsage } from "../asset";
import { type Connection } from "./_shared";
import {
  listDatabaseHistoryAsc,
  recordDatabaseHistory,
  requireDatabaseHistoryOwnerKey,
} from "./history";

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

export async function permanentlyDeleteDatabase(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  id: string;
  workspaceId: string;
}): Promise<boolean> {
  if (!args.tables.Databases) badRequest("Databases table 미설정");
  if (isLCSchedulerDatabaseId(args.id)) {
    forbidden("LC스케줄러 데이터베이스는 영구삭제할 수 없습니다");
  }
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "edit",
  });
  if (args.tables.DatabaseHistory) requireDatabaseHistoryOwnerKey(args.caller);
  const existing = await args.doc.send(
    new GetCommand({ TableName: args.tables.Databases, Key: { id: args.id } }),
  );
  if (!existing.Item) return true;
  if (existing.Item["workspaceId"] !== args.workspaceId) {
    forbidden("다른 워크스페이스의 데이터베이스는 영구삭제할 수 없습니다");
  }
  await args.doc.send(
    new DeleteCommand({
      TableName: args.tables.Databases,
      Key: { id: args.id },
    }),
  );

  if (args.tables.Pages) {
    const rowPageIds = new Set<string>();
    let pageStartKey: Record<string, unknown> | undefined;
    do {
      const r = await args.doc.send(
        new QueryCommand({
          TableName: args.tables.Pages,
          IndexName: "byWorkspaceAndUpdatedAt",
          KeyConditionExpression: "workspaceId = :w",
          FilterExpression: "databaseId = :db",
          ExpressionAttributeValues: {
            ":w": args.workspaceId,
            ":db": args.id,
          },
          ProjectionExpression: "id",
          Limit: 100,
          ExclusiveStartKey: pageStartKey,
        }),
      );
      const items = (r.Items ?? []) as Array<{ id?: unknown }>;
      for (const item of items) {
        if (typeof item.id !== "string") continue;
        rowPageIds.add(item.id);
        await args.doc.send(
          new DeleteCommand({
            TableName: args.tables.Pages,
            Key: { id: item.id },
            ConditionExpression: "workspaceId = :w",
            ExpressionAttributeValues: { ":w": args.workspaceId },
          }),
        );
        try {
          await cascadeDeletePageAssetUsage({ doc: args.doc, tables: args.tables, pageId: item.id });
        } catch (err) {
          console.error("[permanentlyDeleteDatabase] AssetUsage cascade 실패 (무시)", { pageId: item.id, err });
        }
      }
      pageStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (pageStartKey);

    if (args.tables.Comments && rowPageIds.size > 0) {
      let commentStartKey: Record<string, unknown> | undefined;
      do {
        const r = await args.doc.send(
          new QueryCommand({
            TableName: args.tables.Comments,
            IndexName: "byWorkspaceAndUpdatedAt",
            KeyConditionExpression: "workspaceId = :w",
            ExpressionAttributeValues: { ":w": args.workspaceId },
            ProjectionExpression: "id, pageId",
            Limit: 100,
            ExclusiveStartKey: commentStartKey,
          }),
        );
        const comments = (r.Items ?? []) as Array<{ id?: unknown; pageId?: unknown }>;
        await Promise.all(
          comments
            .filter((item) => typeof item.id === "string" && typeof item.pageId === "string" && rowPageIds.has(item.pageId))
            .map(async (item) => {
              await args.doc.send(
                new DeleteCommand({
                  TableName: args.tables.Comments!,
                  Key: { id: item.id },
                  ConditionExpression: "workspaceId = :w",
                  ExpressionAttributeValues: { ":w": args.workspaceId },
                }),
              );
            }),
        );
        commentStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (commentStartKey);
    }
  }
  if (args.tables.DatabaseHistory) {
    const history = (await listDatabaseHistoryAsc({
      doc: args.doc,
      tableName: args.tables.DatabaseHistory,
      databaseId: args.id,
    })).filter((item) => item.workspaceId === args.workspaceId);
    for (let i = 0; i < history.length; i += 25) {
      const chunk = history.slice(i, i + 25);
      await args.doc.send(
        new BatchWriteCommand({
          RequestItems: {
            [args.tables.DatabaseHistory]: chunk.map((item) => ({
              DeleteRequest: { Key: { databaseId: args.id, historyId: item.historyId } },
            })),
          },
        }),
      );
    }
  }
  return true;
}

/**
 * 휴지통의 단일 페이지를 영구 삭제. soft-deleted(deletedAt 존재) 상태일 때만 허용.
 * 휴지통 비우기를 클라이언트에서 청크 단위로 처리하면서 진행률을 보여주기 위해 사용.
 */
export async function permanentlyDeletePage(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  id: string;
  workspaceId: string;
}): Promise<boolean> {
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
    new GetCommand({ TableName: args.tables.Pages, Key: { id: args.id } }),
  );
  if (!existing.Item) return true;
  if (existing.Item["workspaceId"] !== args.workspaceId) {
    forbidden("다른 워크스페이스의 페이지는 영구삭제할 수 없습니다");
  }
  if (!existing.Item["deletedAt"]) {
    forbidden("휴지통에 없는 페이지는 영구삭제할 수 없습니다");
  }
  await args.doc.send(
    new DeleteCommand({
      TableName: args.tables.Pages,
      Key: { id: args.id },
      ConditionExpression: "workspaceId = :w",
      ExpressionAttributeValues: { ":w": args.workspaceId },
    }),
  );

  // 자산 사용 인덱스 cascade — 삭제된 페이지를 가리키는 모든 AssetUsage row 제거.
  try {
    await cascadeDeletePageAssetUsage({ doc: args.doc, tables: args.tables, pageId: args.id });
  } catch (err) {
    console.error("[permanentlyDeletePage] AssetUsage cascade 실패 (무시)", err);
  }

  // 연관 코멘트 정리 — 페이지 ID 매칭 row 만 제거
  if (args.tables.Comments) {
    let commentStartKey: Record<string, unknown> | undefined;
    do {
      const r = await args.doc.send(
        new QueryCommand({
          TableName: args.tables.Comments,
          IndexName: "byWorkspaceAndUpdatedAt",
          KeyConditionExpression: "workspaceId = :w",
          ExpressionAttributeValues: { ":w": args.workspaceId },
          ProjectionExpression: "id, pageId",
          Limit: 100,
          ExclusiveStartKey: commentStartKey,
        }),
      );
      const comments = (r.Items ?? []) as Array<{ id?: unknown; pageId?: unknown }>;
      await Promise.all(
        comments
          .filter(
            (item) =>
              typeof item.id === "string" &&
              typeof item.pageId === "string" &&
              item.pageId === args.id,
          )
          .map(async (item) => {
            await args.doc.send(
              new DeleteCommand({
                TableName: args.tables.Comments!,
                Key: { id: item.id },
                ConditionExpression: "workspaceId = :w",
                ExpressionAttributeValues: { ":w": args.workspaceId },
              }),
            );
          }),
      );
      commentStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (commentStartKey);
  }
  return true;
}

export async function emptyTrash(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
}): Promise<number> {
  if (!args.tables.Pages) badRequest("Pages table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "edit",
  });

  const deletedPageIds = new Set<string>();
  let pageStartKey: Record<string, unknown> | undefined;
  do {
    const r = await args.doc.send(
      new QueryCommand({
        TableName: args.tables.Pages,
        IndexName: "byWorkspaceAndUpdatedAt",
        KeyConditionExpression: "workspaceId = :w",
        ExpressionAttributeValues: { ":w": args.workspaceId },
        FilterExpression: "attribute_exists(deletedAt)",
        ProjectionExpression: "id",
        Limit: 100,
        ExclusiveStartKey: pageStartKey,
      }),
    );
    const items = (r.Items ?? []) as Array<{ id?: unknown }>;
    await Promise.all(
      items
        .map((item) => (typeof item.id === "string" ? item.id : null))
        .filter((id): id is string => !!id)
        .map(async (id) => {
          deletedPageIds.add(id);
          await args.doc.send(
            new DeleteCommand({
              TableName: args.tables.Pages,
              Key: { id },
              ConditionExpression: "workspaceId = :w",
              ExpressionAttributeValues: { ":w": args.workspaceId },
            }),
          );
        }),
    );
    pageStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (pageStartKey);

  // 자산 사용 인덱스 cascade — 휴지통에서 삭제된 모든 페이지의 AssetUsage row 제거.
  for (const pageId of deletedPageIds) {
    try {
      await cascadeDeletePageAssetUsage({ doc: args.doc, tables: args.tables, pageId });
    } catch (err) {
      console.error("[emptyTrash] AssetUsage cascade 실패 (무시)", { pageId, err });
    }
  }

  if (args.tables.Comments && deletedPageIds.size > 0) {
    let commentStartKey: Record<string, unknown> | undefined;
    do {
      const r = await args.doc.send(
        new QueryCommand({
          TableName: args.tables.Comments,
          IndexName: "byWorkspaceAndUpdatedAt",
          KeyConditionExpression: "workspaceId = :w",
          ExpressionAttributeValues: { ":w": args.workspaceId },
          ProjectionExpression: "id, pageId",
          Limit: 100,
          ExclusiveStartKey: commentStartKey,
        }),
      );
      const comments = (r.Items ?? []) as Array<{ id?: unknown; pageId?: unknown }>;
      await Promise.all(
        comments
          .filter((item) => typeof item.id === "string" && typeof item.pageId === "string" && deletedPageIds.has(item.pageId))
          .map(async (item) => {
            await args.doc.send(
              new DeleteCommand({
                TableName: args.tables.Comments!,
                Key: { id: item.id },
                ConditionExpression: "workspaceId = :w",
                ExpressionAttributeValues: { ":w": args.workspaceId },
              }),
            );
          }),
      );
      commentStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (commentStartKey);
  }

  return deletedPageIds.size;
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
        IndexName: "byWorkspaceAndDeletedAt",
        KeyConditionExpression: "workspaceId = :w AND deletedAt > :cutoff",
        ExpressionAttributeValues: {
          ":w": args.workspaceId,
          ":cutoff": cutoffIso,
        },
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
  // 복원 시 TTL 자동삭제 예약(purgeAt)을 반드시 제거한다 — 안 그러면 복원해도 만료시각에 삭제된다(#1).
  delete next["purgeAt"];
  next["updatedAt"] = new Date().toISOString();
  await args.doc.send(
    new PutCommand({
      TableName: args.tables.Pages,
      Item: next,
    }),
  );
  return next;
}

/** 삭제된 데이터베이스 목록(휴지통) — Pages 와 동일한 byWorkspaceAndDeletedAt GSI + 30일 보관 모델 */
export async function listTrashedDatabases(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
  limit?: number;
  nextToken?: string | null;
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
        TableName: args.tables.Databases,
        IndexName: "byWorkspaceAndDeletedAt",
        KeyConditionExpression: "workspaceId = :w AND deletedAt > :cutoff",
        ExpressionAttributeValues: { ":w": args.workspaceId, ":cutoff": cutoffIso },
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
        nextTok = encodeTrashCursor({ ek: r.LastEvaluatedKey as Record<string, unknown>, skip: 0 });
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

/** 삭제된 데이터베이스 복원 — deletedAt 제거(restorePage 와 동일 모델). row 페이지는 삭제되지 않으므로 그대로 복귀. */
export async function restoreDatabase(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  id: string;
  workspaceId: string;
}): Promise<Record<string, unknown>> {
  if (!args.tables.Databases) badRequest("Databases table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "edit",
  });
  const existing = await args.doc.send(
    new GetCommand({ TableName: args.tables.Databases, Key: { id: args.id } }),
  );
  const item = existing.Item as Record<string, unknown> | undefined;
  if (!item) notFound("데이터베이스 없음");
  if (String(item["workspaceId"]) !== args.workspaceId) {
    badRequest("워크스페이스가 일치하지 않습니다");
  }
  if (item["deletedAt"] == null || item["deletedAt"] === "") {
    badRequest("삭제되지 않은 데이터베이스입니다");
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
    new PutCommand({ TableName: args.tables.Databases, Item: next }),
  );
  try {
    await recordDatabaseHistory({
      doc: args.doc,
      tables: args.tables,
      caller: args.caller,
      before: item,
      after: next,
      kind: "database.update",
    });
  } catch (err) {
    console.error("[restoreDatabase] DatabaseHistory 기록 실패 (무시)", err);
  }
  return next;
}
