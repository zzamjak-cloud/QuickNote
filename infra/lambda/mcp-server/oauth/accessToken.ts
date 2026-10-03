// OAuth access token(qn_oat_) 검증 — auth.ts 가 PAT 와 같은 후속 검사(멤버 활성·scope·워크스페이스)를 하도록
// family 레코드를 McpTokenRecord 로 돌려준다. tokenId = familyId 라 분당·일일 쓰기 상한이 family 단위로 걸린다.
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { isMcpTokenActive, isMcpTokenFormat, MCP_OAUTH_ACCESS_PREFIX, type McpTokenRecord } from "../../_shared/mcpToken";
import { getAccess, getFamily } from "./store";

export function isOAuthAccessToken(raw: string): boolean {
  return isMcpTokenFormat(raw, MCP_OAUTH_ACCESS_PREFIX);
}

export async function loadOAuthAccessToken(args: {
  doc: DynamoDBDocumentClient;
  table: string;
  raw: string;
  nowIso: string;
}): Promise<{ ok: true; token: McpTokenRecord } | { ok: false; reason: string }> {
  const access = await getAccess(args.doc, args.table, args.raw);
  if (!access) return { ok: false, reason: "invalid token" };
  if (access.expiresAt <= args.nowIso) return { ok: false, reason: "token expired" };
  const family = await getFamily(args.doc, args.table, access.familyId);
  if (!family) return { ok: false, reason: "invalid token" };
  if (!isMcpTokenActive(family, args.nowIso)) {
    return { ok: false, reason: family.revokedAt ? "token revoked" : "token expired" };
  }
  // access token 이 family 보다 좁은 scope 로 발급됐을 수 있다(refresh 시 scope 축소).
  const scopes = family.scopes.filter((s) => access.scopes.includes(s));
  return { ok: true, token: { ...family, scopes } };
}
