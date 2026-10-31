import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { ResolverError } from "./_auth";
import type { Tables } from "./member";
import { cascadeDeletePageAssetUsage } from "./asset";

/** 클라이언트가 재호출 루프를 돌리는 판별 마커 — 메시지에 포함한다. */
export const WORKSPACE_DELETE_IN_PROGRESS = "WORKSPACE_DELETE_IN_PROGRESS";

// Lambda 타임아웃(28s) 전에 끊고 클라이언트 재호출로 이어가기 위한 예산.
const DEFAULT_BUDGET_MS = 20_000;
const MAX_BACKOFF_MS = 3_000;

type Key = Record<string, unknown>;

type Ctx = {
  doc: DynamoDBDocumentClient;
  deadline: number;
  sleep: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isThrottle(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  return name === "ThrottlingException" || name === "ProvisionedThroughputExceededException";
}

function checkDeadline(ctx: Ctx): void {
  if (Date.now() >= ctx.deadline) {
    throw new ResolverError(
      `${WORKSPACE_DELETE_IN_PROGRESS}: 삭제할 데이터가 많아 나눠서 진행 중입니다`,
      "DeleteInProgress",
    );
  }
}

/**
 * 25개 단위 BatchWrite 삭제. UnprocessedItems·스로틀링은 백오프 재시도한다.
 * 같은 workspaceId 핫키 GSI 에서 쓰기 스로틀이 잦아 재시도 없이는 대량 삭제가 실패한다.
 */
async function batchDelete(ctx: Ctx, tableName: string, keys: Key[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 25) {
    let pending = keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } }));
    let backoff = 100;
    while (pending.length > 0) {
      checkDeadline(ctx);
      try {
        const res = await ctx.doc.send(
          new BatchWriteCommand({ RequestItems: { [tableName]: pending } }),
        );
        pending = (res.UnprocessedItems?.[tableName] ?? []) as typeof pending;
      } catch (err) {
        if (!isThrottle(err)) throw err;
      }
      if (pending.length > 0) {
        await ctx.sleep(backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    }
  }
}

async function queryAll(
  ctx: Ctx,
  params: { TableName: string; IndexName?: string; KeyConditionExpression: string; ExpressionAttributeValues: Key },
): Promise<Key[]> {
  const items: Key[] = [];
  let startKey: Key | undefined;
  do {
    checkDeadline(ctx);
    const res = await ctx.doc.send(new QueryCommand({ ...params, ExclusiveStartKey: startKey }));
    items.push(...((res.Items ?? []) as Key[]));
    startKey = res.LastEvaluatedKey as Key | undefined;
  } while (startKey);
  return items;
}

async function deleteByWorkspaceGsi(
  ctx: Ctx,
  tableName: string | undefined,
  indexName: string | undefined,
  workspaceId: string,
  keyOf: (item: Key) => Key,
): Promise<void> {
  if (!tableName) return;
  const items = await queryAll(ctx, {
    TableName: tableName,
    IndexName: indexName,
    KeyConditionExpression: "workspaceId = :w",
    ExpressionAttributeValues: { ":w": workspaceId },
  });
  await batchDelete(ctx, tableName, items.map(keyOf));
}

/**
 * 워크스페이스와 연관 데이터를 재개 가능한 순서로 삭제한다.
 * 예산 초과 시 DeleteInProgress 를 던지며, 재호출하면 남은 데이터부터 이어서 지운다.
 * 워크스페이스 행은 모든 cascade 가 끝난 뒤 마지막에 지운다(중간 실패 시 재시도 진입점 유지).
 */
export async function deleteWorkspaceCascade(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  workspaceId: string;
  budgetMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<void> {
  const { tables, workspaceId } = args;
  const ctx: Ctx = {
    doc: args.doc,
    deadline: Date.now() + (args.budgetMs ?? DEFAULT_BUDGET_MS),
    sleep: args.sleep ?? defaultSleep,
  };

  await deleteByWorkspaceGsi(ctx, tables.WorkspaceAccess, undefined, workspaceId, (i) => ({
    workspaceId: i.workspaceId,
    subjectKey: i.subjectKey,
  }));

  // AssetUsage 는 pageId 로만 찾을 수 있으므로 페이지 행보다 먼저 지운다 —
  // 페이지를 먼저 지우면 재시도 시 pageId 를 잃어 고아 AssetUsage 가 남는다.
  if (tables.Pages) {
    const pages = await queryAll(ctx, {
      TableName: tables.Pages,
      IndexName: "byWorkspaceAndUpdatedAt",
      KeyConditionExpression: "workspaceId = :w",
      ExpressionAttributeValues: { ":w": workspaceId },
    });
    const pageIds = pages.map((p) => p.id).filter((id): id is string => typeof id === "string");
    for (const pageId of pageIds) {
      checkDeadline(ctx);
      await cascadeDeletePageAssetUsage({ doc: args.doc, tables, pageId });
    }
    await batchDelete(ctx, tables.Pages, pageIds.map((id) => ({ id })));
  }

  const byId = (i: Key) => ({ id: i.id });
  const byIdWs = (i: Key) => ({ id: i.id, workspaceId: i.workspaceId });
  await deleteByWorkspaceGsi(ctx, tables.Databases, "byWorkspaceAndUpdatedAt", workspaceId, byId);
  await deleteByWorkspaceGsi(ctx, tables.Comments, "byWorkspaceAndUpdatedAt", workspaceId, byId);
  await deleteByWorkspaceGsi(ctx, tables.CustomIcons, "byWorkspaceAndCreatedAt", workspaceId, byId);
  await deleteByWorkspaceGsi(ctx, tables.PageHistory, "byWorkspaceAndCreatedAt", workspaceId, (i) => ({
    pageId: i.pageId,
    historyId: i.historyId,
  }));
  await deleteByWorkspaceGsi(ctx, tables.DatabaseHistory, "byWorkspaceAndCreatedAt", workspaceId, (i) => ({
    databaseId: i.databaseId,
    historyId: i.historyId,
  }));
  await deleteByWorkspaceGsi(ctx, tables.Holidays, "byWorkspace", workspaceId, byIdWs);
  await deleteByWorkspaceGsi(ctx, tables.Projects, "byWorkspace", workspaceId, byIdWs);
  await deleteByWorkspaceGsi(ctx, tables.MmEntries, "byWorkspaceAndWeek", workspaceId, byIdWs);

  await args.doc.send(
    new DeleteCommand({ TableName: tables.Workspaces, Key: { workspaceId } }),
  );
}
