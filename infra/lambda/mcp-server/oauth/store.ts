// OAuth 파사드 저장소 — DDB 항목 형태와 원자적 상태 전이.
// 단명 항목(grants 테이블): tx#<id>(authorize 트랜잭션, 10분) · code#<sha256>(인가 코드, 60초) · rt#<sha256>(refresh token).
// mcp-tokens 테이블: oauth-family#<familyId>(연결 앱 grant — 목록·폐기 단위) · oat#<sha256>(access token, 1시간).
// 원문 토큰·코드는 저장하지 않고 해시만 키로 쓴다.
import { GetCommand, PutCommand, UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { hashMcpToken, type McpTokenRecord, type McpTokenScope } from "../../_shared/mcpToken";

const DAY_MS = 24 * 60 * 60 * 1000;
export const CLIENT_TTL_DAYS = 30;
export const FAMILY_KEY_PREFIX = "oauth-family#";
export const ACCESS_KEY_PREFIX = "oat#";

export type OAuthClient = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  createdAt: string;
  lastUsedAt: string;
  /** 미사용 30일 뒤 TTL 삭제 — 사용 시 갱신. */
  ttl: number;
};

export type TxItem = {
  pk: string;
  stage: "login" | "consent" | "done";
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  /** 클라이언트가 요청한 최대 scope(동의 화면에서 낮출 수 있다). */
  scopes: McpTokenScope[];
  resource: string;
  /** Cognito 와의 PKCE·nonce(서버 측 코드 교환용). */
  cognitoVerifier: string;
  nonce: string;
  /** 브라우저 바인딩 쿠키 원문의 SHA-256 — 다른 브라우저가 흐름을 이어받지 못하게 한다. */
  bindingHash: string;
  memberId?: string;
  memberEmail?: string;
  csrfHash?: string;
  allowedWorkspaceIds?: string[];
  expiresAt: string;
  ttl: number;
};

export type CodeItem = {
  pk: string;
  status: "active" | "used";
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  memberId: string;
  scopes: McpTokenScope[];
  workspaceIds: string[];
  resource: string;
  grantDays: number;
  expiresAt: string;
  ttl: number;
};

export type RefreshItem = {
  pk: string;
  status: "active" | "used";
  familyId: string;
  clientId: string;
  expiresAt: string;
  usedAt?: string;
  ttl: number;
};

/** mcp-tokens 테이블의 access token 항목 — memberId 가 없어 byMember GSI 에 들어가지 않는다(sparse). */
export type AccessItem = {
  tokenHash: string;
  tokenId: string;
  kind: "oauth_access";
  familyId: string;
  clientId: string;
  scopes: McpTokenScope[];
  expiresAt: string;
  ttl: number;
};

export function isConditionalFailure(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === "ConditionalCheckFailedException";
}

export function epochSeconds(iso: string, extraMs = 0): number {
  return Math.floor((Date.parse(iso) + extraMs) / 1000);
}

export function familyKey(familyId: string): string {
  return `${FAMILY_KEY_PREFIX}${familyId}`;
}

export function accessKey(rawToken: string): string {
  return `${ACCESS_KEY_PREFIX}${hashMcpToken(rawToken)}`;
}

export function grantKey(kind: "tx" | "code" | "rt", raw: string): string {
  // tx id 는 비밀이 아니지만(쿠키 바인딩으로 보호) 코드·refresh token 은 해시로만 저장한다.
  return kind === "tx" ? `tx#${raw}` : `${kind}#${hashMcpToken(raw)}`;
}

// ---------- 클라이언트 ----------

export async function getClient(doc: DynamoDBDocumentClient, table: string, clientId: string): Promise<OAuthClient | null> {
  const r = await doc.send(new GetCommand({ TableName: table, Key: { clientId } }));
  return (r.Item as OAuthClient | undefined) ?? null;
}

export async function putClient(doc: DynamoDBDocumentClient, table: string, client: OAuthClient): Promise<void> {
  await doc.send(new PutCommand({ TableName: table, Item: client }));
}

/** 사용 시 TTL 연장 — 하루 한 번만 쓴다. 실패해도 흐름은 막지 않는다. */
export async function touchClient(
  doc: DynamoDBDocumentClient,
  table: string,
  client: OAuthClient,
  now: Date,
): Promise<void> {
  if (now.getTime() - Date.parse(client.lastUsedAt) < DAY_MS) return;
  try {
    await doc.send(
      new UpdateCommand({
        TableName: table,
        Key: { clientId: client.clientId },
        UpdateExpression: "SET #ttl = :t, lastUsedAt = :l",
        ConditionExpression: "attribute_exists(clientId)",
        ExpressionAttributeNames: { "#ttl": "ttl" },
        ExpressionAttributeValues: {
          ":t": Math.floor((now.getTime() + CLIENT_TTL_DAYS * DAY_MS) / 1000),
          ":l": now.toISOString(),
        },
      }),
    );
  } catch (err) {
    console.error("oauth 클라이언트 TTL 갱신 실패", err);
  }
}

// ---------- 단명 항목(grants 테이블) ----------

export async function putGrantItem(
  doc: DynamoDBDocumentClient,
  table: string,
  item: TxItem | CodeItem | RefreshItem,
): Promise<void> {
  await doc.send(new PutCommand({ TableName: table, Item: item }));
}

export async function getGrantItem<T>(doc: DynamoDBDocumentClient, table: string, pk: string): Promise<T | null> {
  const r = await doc.send(new GetCommand({ TableName: table, Key: { pk } }));
  return (r.Item as T | undefined) ?? null;
}

/**
 * 조건부 상태 전이(from → to) — 동시에 두 요청이 같은 코드·토큰·트랜잭션을 쓰면 하나만 성공한다.
 * 성공 시 갱신된 항목, 이미 전이됐거나 없으면 null.
 */
export async function transitionGrantItem<T>(args: {
  doc: DynamoDBDocumentClient;
  table: string;
  pk: string;
  attr: "stage" | "status";
  from: string;
  to: string;
  set?: Record<string, unknown>;
}): Promise<T | null> {
  const extra = Object.entries(args.set ?? {});
  const setExpr = ["#s = :to", ...extra.map((_, i) => `#x${i} = :x${i}`)].join(", ");
  try {
    const r = await args.doc.send(
      new UpdateCommand({
        TableName: args.table,
        Key: { pk: args.pk },
        UpdateExpression: `SET ${setExpr}`,
        ConditionExpression: "#s = :from",
        ExpressionAttributeNames: {
          "#s": args.attr,
          ...Object.fromEntries(extra.map(([k], i) => [`#x${i}`, k])),
        },
        ExpressionAttributeValues: {
          ":to": args.to,
          ":from": args.from,
          ...Object.fromEntries(extra.map(([, v], i) => [`:x${i}`, v])),
        },
        ReturnValues: "ALL_NEW",
      }),
    );
    return (r.Attributes as T | undefined) ?? null;
  } catch (err) {
    if (isConditionalFailure(err)) return null;
    throw err;
  }
}

// ---------- grant family · access token(mcp-tokens 테이블) ----------

export async function putFamily(doc: DynamoDBDocumentClient, table: string, record: McpTokenRecord & { ttl: number }): Promise<void> {
  await doc.send(new PutCommand({ TableName: table, Item: record }));
}

export async function getFamily(doc: DynamoDBDocumentClient, table: string, familyId: string): Promise<McpTokenRecord | null> {
  const r = await doc.send(new GetCommand({ TableName: table, Key: { tokenHash: familyKey(familyId) } }));
  const item = r.Item as McpTokenRecord | undefined;
  return item && item.kind === "oauth" ? item : null;
}

/** family 폐기 — 그 family 의 모든 access·refresh token 이 다음 사용 때 거부된다(auth·refresh 가 family 를 확인). */
export async function revokeFamily(doc: DynamoDBDocumentClient, table: string, familyId: string, nowIso: string): Promise<void> {
  try {
    await doc.send(
      new UpdateCommand({
        TableName: table,
        Key: { tokenHash: familyKey(familyId) },
        UpdateExpression: "SET revokedAt = :r",
        ConditionExpression: "attribute_exists(tokenHash)",
        ExpressionAttributeValues: { ":r": nowIso },
      }),
    );
  } catch (err) {
    if (!isConditionalFailure(err)) throw err;
  }
}

export async function putAccess(doc: DynamoDBDocumentClient, table: string, item: AccessItem): Promise<void> {
  await doc.send(new PutCommand({ TableName: table, Item: item }));
}

export async function getAccess(doc: DynamoDBDocumentClient, table: string, rawToken: string): Promise<AccessItem | null> {
  const r = await doc.send(new GetCommand({ TableName: table, Key: { tokenHash: accessKey(rawToken) } }));
  const item = r.Item as AccessItem | undefined;
  return item && item.kind === "oauth_access" ? item : null;
}

// ---------- IP 단위 요청 상한(ai-usage 원자 카운터 패턴, pk=mcp-oa#…) ----------

/** 한도 이내면 true. windowSec 단위 고정 창. */
export async function consumeIpQuota(args: {
  doc: DynamoDBDocumentClient;
  table: string;
  key: string;
  windowSec: number;
  limit: number;
  nowMs: number;
}): Promise<boolean> {
  const window = Math.floor(args.nowMs / 1000 / args.windowSec);
  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.table,
      Key: { pk: `mcp-oa#${args.key}`, sk: String(window) },
      UpdateExpression: "ADD cnt :one SET expiresAt = :exp",
      ExpressionAttributeValues: { ":one": 1, ":exp": Math.floor(args.nowMs / 1000) + args.windowSec * 2 },
      ReturnValues: "ALL_NEW",
    }),
  );
  return Number(r.Attributes?.cnt ?? 0) <= args.limit;
}

export function daysFrom(now: Date, days: number): string {
  return new Date(now.getTime() + days * DAY_MS).toISOString();
}
