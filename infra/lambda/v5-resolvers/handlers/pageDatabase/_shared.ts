import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  forbidden,
  notFound,
  requireWorkspaceAccess,
  type Member,
} from "../_auth";
import type { Tables } from "../member";

export type Connection<T> = { items: T[]; nextToken?: string | null };

export type BaseRecord = {
  id: string;
  workspaceId: string;
  createdByMemberId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export function cloneJson<T>(value: T): T {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

export function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseJsonLike(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export async function upsertRecord(args: {
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
  // 교차 워크스페이스 덮어쓰기(IDOR) 차단: id 단독 PK 이므로 ConditionExpression 없이 Put 하면
  // 다른 워크스페이스의 레코드를 input.id 충돌만으로 전치환·탈취할 수 있다.
  // 신규(attribute_not_exists) 이거나 기존 레코드의 workspaceId 가 일치할 때만 허용한다.
  try {
    await args.doc.send(
      new PutCommand({
        TableName: args.tableName,
        Item: {
          ...args.input,
          createdByMemberId: input.createdByMemberId || args.caller.memberId,
        },
        ConditionExpression: "attribute_not_exists(workspaceId) OR workspaceId = :w",
        ExpressionAttributeValues: { ":w": input.workspaceId },
      }),
    );
  } catch (err) {
    if ((err as { name?: string })?.name === "ConditionalCheckFailedException") {
      forbidden("다른 워크스페이스의 레코드는 수정할 수 없습니다");
    }
    throw err;
  }
  return args.input;
}

export async function softDeleteRecord(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  tableName: string;
  id: string;
  workspaceId: string;
  updatedAt: string;
  /**
   * 지정 시 purgeAt(epoch seconds) 을 함께 기록한다(#1).
   * Pages 테이블에는 TTL(purgeAt)이 설정돼 있어 이 시각이 지나면 DynamoDB 가 자동·무료로 영구삭제한다.
   * (Databases 테이블에는 TTL 이 없으므로 전달하지 않는다.)
   */
  ttlSeconds?: number;
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
  const setPurge = typeof args.ttlSeconds === "number" && Number.isFinite(args.ttlSeconds);
  // byDatabaseAndOrder GSI 파티션 키(databaseId)가 NULL 타입으로 남아 있으면 Update 도
  // "Type mismatch ... actual: NULL" 로 거부된다. 기존 항목이 NULL databaseId 면 함께 제거한다.
  const removeNullDatabaseId =
    "databaseId" in existing.Item && existing.Item.databaseId == null;
  const setExpr = setPurge
    ? "SET deletedAt = :d, updatedAt = :u, purgeAt = :p"
    : "SET deletedAt = :d, updatedAt = :u";
  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tableName,
      Key: { id: args.id },
      UpdateExpression: removeNullDatabaseId ? `${setExpr} REMOVE databaseId` : setExpr,
      ExpressionAttributeValues: {
        ":d": now,
        ":u": now,
        ":w": args.workspaceId,
        ...(setPurge ? { ":p": args.ttlSeconds } : {}),
      },
      // 삭제(휴지통 이동)는 사용자의 명시 의도이므로 updatedAt 낙관적 동시성 가드로 막지 않는다.
      // 과거 "updatedAt <= :old" 는 시계 skew·동시 편집·collab materialize 로 서버 updatedAt 이
      // 클라 삭제시각보다 최신이면 조건 실패 → softDelete 가 throw 되어 deletedAt 미설정 →
      // DB/페이지가 로컬에선 사라졌으나 서버엔 살아있고 휴지통에도 없는 유실이 간헐 발생했다.
      // 워크스페이스 일치만 확인한다(삭제는 복원 가능하므로 안전).
      ConditionExpression: "workspaceId = :w",
      ReturnValues: "ALL_NEW",
    }),
  );
  return (r.Attributes ?? {}) as Record<string, unknown>;
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
