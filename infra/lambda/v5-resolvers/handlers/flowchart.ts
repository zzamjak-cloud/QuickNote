// 플로우차트 공유 자원 리졸버 — Database 패턴의 최소 버전.
// data(AWSJSON) 한 필드만 보관하고 updatedAt(ISO) LWW 로 충돌을 해소한다.
import { randomUUID } from "node:crypto";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { badRequest, requireWorkspaceAccess, type Member } from "./_auth";
import type { Tables } from "./member";

type Connection<T> = { items: T[]; nextToken: string | null };

// AppSync 가 AWSJSON 을 파싱된 객체로 넘기는 경우가 있어 문자열로 정규화한다.
function normalizeDataField(input: Record<string, unknown>): void {
  const value = input.data;
  if (value == null) return;
  if (typeof value === "string") return;
  if (typeof value !== "object") {
    badRequest("data 는 JSON 객체·문자열·null 이어야 합니다");
  }
  try {
    input.data = JSON.stringify(value);
  } catch {
    badRequest("data JSON 직렬화에 실패했습니다");
  }
}

export async function listFlowcharts(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
  updatedAfter?: string;
  limit?: number;
  nextToken?: string;
}): Promise<Connection<Record<string, unknown>>> {
  if (!args.tables.Flowcharts) badRequest("Flowcharts table 미설정");
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
        values: { ":w": args.workspaceId, ":u": args.updatedAfter },
      }
    : {
        expression: "workspaceId = :w",
        values: { ":w": args.workspaceId },
      };
  const r = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.Flowcharts,
      IndexName: "byWorkspaceAndUpdatedAt",
      KeyConditionExpression: query.expression,
      ExpressionAttributeValues: query.values,
      Limit: args.limit ?? 200,
      ExclusiveStartKey: args.nextToken ? JSON.parse(args.nextToken) : undefined,
    }),
  );
  return {
    items: (r.Items ?? []) as Record<string, unknown>[],
    nextToken: r.LastEvaluatedKey ? JSON.stringify(r.LastEvaluatedKey) : null,
  };
}

export async function getFlowchart(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  id: string;
  workspaceId: string;
}): Promise<Record<string, unknown> | null> {
  if (!args.tables.Flowcharts) badRequest("Flowcharts table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });
  const r = await args.doc.send(
    new GetCommand({ TableName: args.tables.Flowcharts, Key: { id: args.id } }),
  );
  const item = r.Item as Record<string, unknown> | undefined;
  if (!item) return null;
  if (String(item["workspaceId"]) !== args.workspaceId) return null;
  return item;
}

export async function upsertFlowchart(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  if (!args.tables.Flowcharts) badRequest("Flowcharts table 미설정");
  const id = typeof args.input.id === "string" ? args.input.id : "";
  const workspaceId =
    typeof args.input.workspaceId === "string" ? args.input.workspaceId : "";
  if (!id || !workspaceId) badRequest("id/workspaceId 필요");
  normalizeDataField(args.input);

  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId,
    required: "edit",
  });

  const tableName = args.tables.Flowcharts;
  const incomingUpdatedAt =
    typeof args.input.updatedAt === "string" ? args.input.updatedAt : "";

  const existing = await args.doc.send(
    new GetCommand({ TableName: tableName, Key: { id } }),
  );
  const existingItem = existing.Item as Record<string, unknown> | undefined;
  const existingUpdatedAt =
    typeof existingItem?.updatedAt === "string"
      ? (existingItem.updatedAt as string)
      : "";

  // LWW: 더 오래됐거나 같으면 무시하고 기존값 반환(ISO 문자열 사전식 = 시간순).
  if (
    existingItem &&
    existingUpdatedAt &&
    incomingUpdatedAt &&
    incomingUpdatedAt <= existingUpdatedAt
  ) {
    return existingItem;
  }

  const item: Record<string, unknown> = {
    ...(existingItem ?? {}),
    ...args.input,
    deletedAt: null,
  };
  await args.doc.send(new PutCommand({ TableName: tableName, Item: item }));
  return item;
}

// ── 버전 히스토리 (append-only 스냅샷) ──
// 테이블 FlowchartHistory: PK=flowchartId, SK=historyId(`${ISO}#${uuid}` 시간순 정렬).

export async function saveFlowchartVersion(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  flowchartId: string;
  workspaceId: string;
  title: string;
  data: unknown;
}): Promise<Record<string, unknown>> {
  if (!args.tables.FlowchartHistory) badRequest("FlowchartHistory table 미설정");
  if (!args.flowchartId || !args.workspaceId) badRequest("flowchartId/workspaceId 필요");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "edit",
  });
  const dataStr =
    typeof args.data === "string" ? args.data : JSON.stringify(args.data ?? {});
  const nowIso = new Date().toISOString();
  const item: Record<string, unknown> = {
    flowchartId: args.flowchartId,
    historyId: `${nowIso}#${randomUUID()}`,
    workspaceId: args.workspaceId,
    title: typeof args.title === "string" ? args.title : "",
    data: dataStr,
    createdAt: nowIso,
    createdByMemberId: args.caller.memberId,
    createdByName: args.caller.name,
  };
  await args.doc.send(
    new PutCommand({ TableName: args.tables.FlowchartHistory, Item: item }),
  );
  return item;
}

export async function listFlowchartHistory(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  flowchartId: string;
  workspaceId: string;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  if (!args.tables.FlowchartHistory) badRequest("FlowchartHistory table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });
  const r = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.FlowchartHistory,
      KeyConditionExpression: "flowchartId = :f",
      ExpressionAttributeValues: { ":f": args.flowchartId },
      ScanIndexForward: false, // 최신순
      Limit: args.limit ?? 100,
    }),
  );
  return (r.Items ?? []) as Record<string, unknown>[];
}

export async function softDeleteFlowchart(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  id: string;
  workspaceId: string;
  updatedAt: string;
}): Promise<Record<string, unknown>> {
  if (!args.tables.Flowcharts) badRequest("Flowcharts table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "edit",
  });
  const tableName = args.tables.Flowcharts;
  const existing = await args.doc.send(
    new GetCommand({ TableName: tableName, Key: { id: args.id } }),
  );
  const existingItem = existing.Item as Record<string, unknown> | undefined;
  if (!existingItem || String(existingItem.workspaceId) !== args.workspaceId) {
    badRequest("플로우차트를 찾을 수 없습니다");
  }
  const item: Record<string, unknown> = {
    ...existingItem,
    deletedAt: args.updatedAt,
    updatedAt: args.updatedAt,
  };
  await args.doc.send(new PutCommand({ TableName: tableName, Item: item }));
  return item;
}
