// MCP Personal Access Token 발급·조회·폐기 리졸버.
// 원문 토큰은 createMcpToken 응답에 한 번만 반환하고, 저장·조회 응답에는 해시를 절대 싣지 않는다.
import { randomUUID } from "node:crypto";
import { PutCommand, QueryCommand, UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import {
  generateMcpToken,
  hashMcpToken,
  isMcpTokenActive,
  MCP_TOKEN_SCOPES,
  type McpTokenRecord,
} from "../../_shared/mcpToken";
import { badRequest, hasWorkspaceViewAccess, notFound, type Member } from "./_auth";
import type { Tables } from "./member";

/** 멤버당 활성(미폐기·미만료) 토큰 상한. */
export const MAX_ACTIVE_MCP_TOKENS = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

const createInputSchema = z.object({
  name: z.string().trim().min(1).max(64),
  scopes: z
    .array(z.enum(MCP_TOKEN_SCOPES))
    .min(1)
    .refine((s) => s.includes("read"), { message: "scopes 에 read 가 포함되어야 합니다" }),
  workspaceIds: z
    .array(z.string().trim().min(1).max(128))
    .max(50)
    .nullish()
    .transform((v) => v ?? []),
  expiresInDays: z.number().int().min(1).max(365).nullish(),
});

export type CreateMcpTokenInput = z.input<typeof createInputSchema>;

export type McpTokenMeta = Omit<McpTokenRecord, "tokenHash" | "memberId" | "clientId"> & { kind: "pat" | "oauth" };

type BaseArgs = { doc: DynamoDBDocumentClient; tables: Tables; caller: Member };

function requireTable(tables: Tables): string {
  if (!tables.McpTokens) badRequest("McpTokens table 미설정");
  return tables.McpTokens;
}

/** 저장 항목 → 응답 메타(해시·memberId 제외). OAuth 연결 앱은 kind "oauth", name = 클라이언트 이름. */
export function toMcpTokenMeta(record: McpTokenRecord): McpTokenMeta {
  return {
    tokenId: record.tokenId,
    kind: record.kind ?? "pat",
    name: record.name,
    scopes: record.scopes,
    workspaceIds: record.workspaceIds ?? [],
    tokenHint: record.tokenHint,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt ?? null,
    lastUsedAt: record.lastUsedAt ?? null,
    revokedAt: record.revokedAt ?? null,
  };
}

async function queryMemberTokens(args: BaseArgs): Promise<McpTokenRecord[]> {
  const items: McpTokenRecord[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const r = await args.doc.send(
      new QueryCommand({
        TableName: requireTable(args.tables),
        IndexName: "byMember",
        KeyConditionExpression: "memberId = :m",
        ExpressionAttributeValues: { ":m": args.caller.memberId },
        ScanIndexForward: false,
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...((r.Items ?? []) as McpTokenRecord[]));
    lastKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return items;
}

async function assertWorkspacesAccessible(args: BaseArgs, workspaceIds: string[]): Promise<void> {
  for (const workspaceId of workspaceIds) {
    const ok = await hasWorkspaceViewAccess({
      doc: args.doc,
      memberTeamsTableName: args.tables.MemberTeams,
      workspaceAccessTableName: args.tables.WorkspaceAccess,
      caller: args.caller,
      workspaceId,
    });
    if (!ok) badRequest(`접근할 수 없는 워크스페이스: ${workspaceId}`);
  }
}

export async function createMcpToken(
  args: BaseArgs & { input: unknown },
): Promise<McpTokenMeta & { token: string }> {
  const parsed = createInputSchema.safeParse(args.input ?? {});
  if (!parsed.success) badRequest(`잘못된 입력: ${parsed.error.issues.map((i) => i.message).join(", ")}`);
  const input = parsed.data;
  const workspaceIds = Array.from(new Set(input.workspaceIds));
  const now = new Date();
  const nowIso = now.toISOString();

  // 상한은 PAT 만 센다 — OAuth 연결 앱(grant family)은 별도.
  const active = (await queryMemberTokens(args)).filter(
    (t) => (t.kind ?? "pat") === "pat" && isMcpTokenActive(t, nowIso),
  );
  if (active.length >= MAX_ACTIVE_MCP_TOKENS) {
    badRequest(`활성 토큰은 최대 ${MAX_ACTIVE_MCP_TOKENS}개까지 발급할 수 있습니다`);
  }
  await assertWorkspacesAccessible(args, workspaceIds);

  const token = generateMcpToken();
  const record: McpTokenRecord = {
    tokenHash: hashMcpToken(token),
    tokenId: randomUUID(),
    memberId: args.caller.memberId,
    name: input.name,
    scopes: MCP_TOKEN_SCOPES.filter((s) => input.scopes.includes(s)),
    workspaceIds,
    tokenHint: token.slice(-4),
    createdAt: nowIso,
    expiresAt: input.expiresInDays ? new Date(now.getTime() + input.expiresInDays * DAY_MS).toISOString() : null,
    lastUsedAt: null,
    revokedAt: null,
  };
  await args.doc.send(
    new PutCommand({
      TableName: requireTable(args.tables),
      Item: record,
      ConditionExpression: "attribute_not_exists(tokenHash)",
    }),
  );
  return { ...toMcpTokenMeta(record), token };
}

export async function listMcpTokens(args: BaseArgs): Promise<McpTokenMeta[]> {
  return (await queryMemberTokens(args)).map(toMcpTokenMeta);
}

export async function revokeMcpToken(args: BaseArgs & { tokenId: string }): Promise<McpTokenMeta> {
  const tokenId = typeof args.tokenId === "string" ? args.tokenId.trim() : "";
  if (!tokenId) badRequest("tokenId 필요");
  const target = (await queryMemberTokens(args)).find((t) => t.tokenId === tokenId);
  if (!target) notFound("토큰 없음");
  if (target.revokedAt) return toMcpTokenMeta(target);

  const revokedAt = new Date().toISOString();
  // OAuth 연결 앱은 family 레코드 하나만 폐기하면 그 family 의 access·refresh token 이 모두 거부된다.
  // 본인 소유 확인을 조건식으로도 강제한다(GSI 조회와 Update 사이 경합 방어).
  await args.doc.send(
    new UpdateCommand({
      TableName: requireTable(args.tables),
      Key: { tokenHash: target.tokenHash },
      UpdateExpression: "SET revokedAt = :r",
      ConditionExpression: "memberId = :m",
      ExpressionAttributeValues: { ":r": revokedAt, ":m": args.caller.memberId },
    }),
  );
  return toMcpTokenMeta({ ...target, revokedAt });
}
