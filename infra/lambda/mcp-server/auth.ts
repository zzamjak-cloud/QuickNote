// Bearer PAT 인증 — 해시 조회 → 폐기·만료 검사 → 소유 Member 활성 검사 → lastUsedAt 스로틀 갱신.
import { GetCommand, UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Member } from "../v5-resolvers/handlers/_auth";
import {
  hashMcpToken,
  isMcpTokenActive,
  isMcpTokenFormat,
  type McpTokenRecord,
} from "../_shared/mcpToken";
import type { McpTables } from "./context";

/** lastUsedAt 쓰기 간격 — 매 요청 쓰기를 피한다. */
export const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

export type AuthResult =
  | { ok: true; token: McpTokenRecord; caller: Member }
  | { ok: false; reason: string };

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

async function touchLastUsed(
  doc: DynamoDBDocumentClient,
  tables: McpTables,
  token: McpTokenRecord,
  now: Date,
): Promise<void> {
  const last = token.lastUsedAt ? Date.parse(token.lastUsedAt) : 0;
  if (Number.isFinite(last) && now.getTime() - last < LAST_USED_WRITE_INTERVAL_MS) return;
  try {
    await doc.send(
      new UpdateCommand({
        TableName: tables.McpTokens,
        Key: { tokenHash: token.tokenHash },
        UpdateExpression: "SET lastUsedAt = :t",
        ConditionExpression: "attribute_exists(tokenHash)",
        ExpressionAttributeValues: { ":t": now.toISOString() },
      }),
    );
  } catch (err) {
    // 사용 시각 기록 실패가 인증 자체를 막지는 않는다.
    console.error("mcp lastUsedAt 갱신 실패", err);
  }
}

export async function authenticate(args: {
  doc: DynamoDBDocumentClient;
  tables: McpTables;
  authorization: string | undefined;
  now?: Date;
}): Promise<AuthResult> {
  const now = args.now ?? new Date();
  const raw = extractBearer(args.authorization);
  if (!raw) return { ok: false, reason: "missing bearer token" };
  if (!isMcpTokenFormat(raw)) return { ok: false, reason: "invalid token" };

  const tokenRes = await args.doc.send(
    new GetCommand({ TableName: args.tables.McpTokens, Key: { tokenHash: hashMcpToken(raw) } }),
  );
  const token = tokenRes.Item as McpTokenRecord | undefined;
  if (!token) return { ok: false, reason: "invalid token" };
  if (!isMcpTokenActive(token, now.toISOString())) {
    return { ok: false, reason: token.revokedAt ? "token revoked" : "token expired" };
  }

  // _auth.getCallerMember 와 같은 기준: status === "active" 만 허용(removed 등 거부).
  const memberRes = await args.doc.send(
    new GetCommand({ TableName: args.tables.Members, Key: { memberId: token.memberId } }),
  );
  const caller = memberRes.Item as Member | undefined;
  if (!caller || caller.status !== "active") return { ok: false, reason: "member inactive" };

  await touchLastUsed(args.doc, args.tables, token, now);
  return { ok: true, token, caller };
}
