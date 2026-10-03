// MCP 토큰 관리자 조회·강제 폐기 — 퇴사자 처리·사고 대응용.
// 관리자 = manager 이상(설정 모달의 구성원·워크스페이스 관리 탭 노출 기준 isAdmin, 서버 getMember·updateMember·
// updateWorkspace 의 requireRoleAtLeast("manager") 와 같다).
// 대상: PAT 와 OAuth grant family(oauth-family#) 레코드만. 단명 access token(oat#) 항목은 제외하고, 해시는 절대 응답하지 않는다.
import { BatchGetCommand, QueryCommand, ScanCommand, UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { isMcpTokenActive, type McpTokenRecord } from "../../_shared/mcpToken";
import { badRequest, notFound, requireRoleAtLeast, type Member } from "./_auth";
import type { Tables } from "./member";

type BaseArgs = { doc: DynamoDBDocumentClient; tables: Tables; caller: Member };
type Item = Record<string, unknown>;

export type McpTokenStatus = "active" | "revoked" | "expired";

export type AdminMcpToken = {
  tokenId: string;
  kind: "pat" | "oauth";
  name: string;
  /** OAuth 연결 앱 이름(PAT 는 null). */
  clientName: string | null;
  memberId: string;
  memberName: string | null;
  memberEmail: string | null;
  scopes: string[];
  workspaceIds: string[];
  workspaces: { workspaceId: string; name: string }[];
  tokenHint: string;
  status: McpTokenStatus;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
};

const filterSchema = z
  .object({
    memberId: z.string().trim().min(1).max(128).nullish(),
    kind: z.enum(["pat", "oauth"]).nullish(),
    status: z.enum(["active", "revoked", "expired"]).nullish(),
  })
  .nullish();
const reasonSchema = z.string().trim().max(200).nullish();

function parseReason(reason: unknown): string | null {
  const r = reasonSchema.safeParse(reason);
  if (!r.success) badRequest("사유는 200자 이하");
  return r.data || null;
}

const ACCESS_TOKEN_PREFIX = "oat#";
const MAX_PAGE = 100;

/** PAT·OAuth family 레코드인지(단명 access token oat# 항목·소유자 없는 항목 제외). */
function isGrantRecord(t: McpTokenRecord): boolean {
  return typeof t.tokenHash === "string" && !t.tokenHash.startsWith(ACCESS_TOKEN_PREFIX) && Boolean(t.memberId);
}

export function requireMcpTokenAdmin(caller: Member): void {
  requireRoleAtLeast(caller, "manager");
}

function tokensTable(tables: Tables): string {
  if (!tables.McpTokens) badRequest("McpTokens table 미설정");
  return tables.McpTokens;
}

export function tokenStatus(record: McpTokenRecord, nowIso: string): McpTokenStatus {
  if (record.revokedAt) return "revoked";
  return isMcpTokenActive(record, nowIso) ? "active" : "expired";
}

function encodeToken(key: Item | undefined): string | null {
  return key ? Buffer.from(JSON.stringify(key), "utf8").toString("base64url") : null;
}

function decodeToken(token: string | null | undefined): Item | undefined {
  if (!token) return undefined;
  try {
    return JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Item;
  } catch {
    return badRequest("잘못된 nextToken");
  }
}

async function batchGet(doc: DynamoDBDocumentClient, table: string, keyName: string, ids: string[]): Promise<Item[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const out: Item[] = [];
  for (let i = 0; i < unique.length; i += 100) {
    const r = await doc.send(new BatchGetCommand({
      RequestItems: { [table]: { Keys: unique.slice(i, i + 100).map((id) => ({ [keyName]: id })) } },
    }));
    out.push(...((r.Responses?.[table] ?? []) as Item[]));
  }
  return out;
}

async function enrich(args: BaseArgs, records: McpTokenRecord[], nowIso: string): Promise<AdminMcpToken[]> {
  const members = await batchGet(args.doc, args.tables.Members, "memberId", records.map((r) => r.memberId));
  const memberById = new Map(members.map((m) => [String(m.memberId), m]));
  const workspaces = await batchGet(args.doc, args.tables.Workspaces, "workspaceId", records.flatMap((r) => r.workspaceIds ?? []));
  const wsName = new Map(workspaces.map((w) => [String(w.workspaceId), String(w.name ?? "")]));
  return records.map((r) => {
    const kind = r.kind === "oauth" ? "oauth" : "pat";
    const member = memberById.get(r.memberId);
    return {
      tokenId: r.tokenId,
      kind,
      name: r.name,
      clientName: kind === "oauth" ? r.name : null,
      memberId: r.memberId,
      memberName: member ? String(member.name ?? "") : null,
      memberEmail: member ? String(member.email ?? "") : null,
      scopes: r.scopes ?? [],
      workspaceIds: r.workspaceIds ?? [],
      workspaces: (r.workspaceIds ?? []).map((id) => ({ workspaceId: id, name: wsName.get(id) ?? id })),
      tokenHint: r.tokenHint,
      status: tokenStatus(r, nowIso),
      createdAt: r.createdAt,
      expiresAt: r.expiresAt ?? null,
      lastUsedAt: r.lastUsedAt ?? null,
      revokedAt: r.revokedAt ?? null,
      revokedBy: r.revokedBy ?? null,
      revokeReason: r.revokeReason ?? null,
    };
  });
}

/** PAT·OAuth family 레코드 스캔 조건(oat# 제외 + 선택 필터). 상태는 시각 의존이라 코드에서 거른다. */
function scanFilter(filter: z.infer<typeof filterSchema>) {
  const parts = ["NOT begins_with(tokenHash, :oat)", "attribute_exists(memberId)"];
  const values: Item = { ":oat": ACCESS_TOKEN_PREFIX };
  if (filter?.memberId) {
    parts.push("memberId = :m");
    values[":m"] = filter.memberId;
  }
  if (filter?.kind === "oauth") {
    parts.push("kind = :k");
    values[":k"] = "oauth";
  } else if (filter?.kind === "pat") {
    parts.push("(attribute_not_exists(kind) OR kind = :k)");
    values[":k"] = "pat";
  }
  return { FilterExpression: parts.join(" AND "), ExpressionAttributeValues: values };
}

export async function adminListMcpTokens(args: BaseArgs & { filter?: unknown; limit?: number | null; nextToken?: string | null }) {
  requireMcpTokenAdmin(args.caller);
  const parsed = filterSchema.safeParse(args.filter);
  if (!parsed.success) badRequest("잘못된 필터");
  const filter = parsed.data;
  const limit = Math.min(Math.max(args.limit ?? 50, 1), MAX_PAGE);
  const nowIso = new Date().toISOString();
  const r = await args.doc.send(new ScanCommand({
    TableName: tokensTable(args.tables),
    Limit: limit,
    ExclusiveStartKey: decodeToken(args.nextToken),
    ...scanFilter(filter),
  }));
  // 스캔 필터와 같은 조건을 코드에서도 한 번 더 건다(access token·해시 노출 방어선).
  const records = ((r.Items ?? []) as McpTokenRecord[]).filter((t) =>
    isGrantRecord(t)
    && (!filter?.memberId || t.memberId === filter.memberId)
    && (!filter?.kind || (t.kind === "oauth" ? "oauth" : "pat") === filter.kind)
    && (!filter?.status || tokenStatus(t, nowIso) === filter.status));
  const items = (await enrich(args, records, nowIso)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { items, nextToken: encodeToken(r.LastEvaluatedKey as Item | undefined) };
}

async function findByTokenId(args: BaseArgs, tokenId: string): Promise<McpTokenRecord> {
  let lastKey: Item | undefined;
  do {
    const r = await args.doc.send(new ScanCommand({
      TableName: tokensTable(args.tables),
      FilterExpression: "tokenId = :t AND NOT begins_with(tokenHash, :oat)",
      ExpressionAttributeValues: { ":t": tokenId, ":oat": ACCESS_TOKEN_PREFIX },
      ExclusiveStartKey: lastKey,
    }));
    const hit = ((r.Items ?? []) as McpTokenRecord[]).find((t) => t.tokenId === tokenId && isGrantRecord(t));
    if (hit) return hit;
    lastKey = r.LastEvaluatedKey as Item | undefined;
  } while (lastKey);
  return notFound("토큰 없음");
}

/** 레코드 하나 폐기. OAuth family 레코드를 폐기하면 그 family 의 access·refresh 가 모두 거부된다(auth.ts·token.ts). */
async function revokeRecord(args: BaseArgs, record: McpTokenRecord, reason: string | null, nowIso: string): Promise<McpTokenRecord> {
  if (record.revokedAt) return record;
  await args.doc.send(new UpdateCommand({
    TableName: tokensTable(args.tables),
    Key: { tokenHash: record.tokenHash },
    UpdateExpression: "SET revokedAt = :r, revokedBy = :b, revokeReason = :why",
    ConditionExpression: "attribute_exists(tokenHash)",
    ExpressionAttributeValues: { ":r": nowIso, ":b": args.caller.memberId, ":why": reason },
  }));
  console.info(JSON.stringify({
    evt: "mcp.admin.revoke",
    adminMemberId: args.caller.memberId,
    tokenId: record.tokenId,
    kind: record.kind ?? "pat",
    ownerMemberId: record.memberId,
    reason,
  }));
  return { ...record, revokedAt: nowIso, revokedBy: args.caller.memberId, revokeReason: reason };
}

export async function adminRevokeMcpToken(args: BaseArgs & { tokenId: string; reason?: string | null }): Promise<AdminMcpToken> {
  requireMcpTokenAdmin(args.caller);
  const tokenId = typeof args.tokenId === "string" ? args.tokenId.trim() : "";
  if (!tokenId) badRequest("tokenId 필요");
  const reason = parseReason(args.reason);
  const nowIso = new Date().toISOString();
  const revoked = await revokeRecord(args, await findByTokenId(args, tokenId), reason, nowIso);
  return (await enrich(args, [revoked], nowIso))[0];
}

/** 퇴사자 처리 — 그 멤버의 활성 PAT·OAuth 연결을 모두 폐기한다. */
export async function adminRevokeMcpTokensByMember(args: BaseArgs & { memberId: string; reason?: string | null }) {
  requireMcpTokenAdmin(args.caller);
  const memberId = typeof args.memberId === "string" ? args.memberId.trim() : "";
  if (!memberId) badRequest("memberId 필요");
  const reason = parseReason(args.reason);
  const nowIso = new Date().toISOString();
  const records: McpTokenRecord[] = [];
  let lastKey: Item | undefined;
  do {
    const r = await args.doc.send(new QueryCommand({
      TableName: tokensTable(args.tables),
      IndexName: "byMember",
      KeyConditionExpression: "memberId = :m",
      ExpressionAttributeValues: { ":m": memberId },
      ExclusiveStartKey: lastKey,
    }));
    records.push(...((r.Items ?? []) as McpTokenRecord[]));
    lastKey = r.LastEvaluatedKey as Item | undefined;
  } while (lastKey);
  const targets = records.filter((t) => isGrantRecord(t) && !t.revokedAt);
  const revoked: McpTokenRecord[] = [];
  for (const t of targets) revoked.push(await revokeRecord(args, t, reason, nowIso));
  return { memberId, revokedCount: revoked.length, items: await enrich(args, revoked, nowIso) };
}
