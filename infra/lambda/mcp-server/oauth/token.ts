// /token(authorization_code · refresh_token) · /revoke(RFC 7009).
// access token(qn_oat_, 1시간)과 grant family 는 mcp-tokens 테이블, refresh token(qn_ort_)은 grants 테이블.
// refresh 는 매번 회전하고, 이미 쓴 refresh token 이 다시 오면 탈취로 보고 family 전체를 폐기한다.
import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  generateMcpToken,
  isMcpTokenActive,
  isMcpTokenFormat,
  MCP_OAUTH_ACCESS_PREFIX,
  MCP_OAUTH_REFRESH_PREFIX,
  type McpTokenRecord,
  type McpTokenScope,
} from "../../_shared/mcpToken";
import { isOwnResource } from "./authorize";
import { originOf } from "./config";
import { isPkceVerifier, verifyPkceS256 } from "./crypto";
import type { OAuthDeps } from "./deps";
import { clientIp, header, isFormRequest, oauthError, parseForm, single, tokenJson, type Result } from "./http";
import {
  accessKey,
  consumeIpQuota,
  daysFrom,
  epochSeconds,
  familyKey,
  getAccess,
  getClient,
  getFamily,
  getGrantItem,
  grantKey,
  putAccess,
  putFamily,
  putGrantItem,
  revokeFamily,
  transitionGrantItem,
  type CodeItem,
  type OAuthClient,
  type RefreshItem,
} from "./store";

export const ACCESS_TOKEN_TTL_SEC = 3600;
const TOKEN_LIMIT_PER_MIN = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

type Issued = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };

/** 같은 family 로 access·refresh 한 쌍을 발급한다. 수명은 family 만료를 넘지 않는다. */
async function issuePair(deps: OAuthDeps, family: McpTokenRecord, scopes: McpTokenScope[], now: Date): Promise<Issued> {
  const familyExpiry = family.expiresAt ?? daysFrom(now, 30);
  const accessExpiry = new Date(Math.min(now.getTime() + ACCESS_TOKEN_TTL_SEC * 1000, Date.parse(familyExpiry))).toISOString();
  const access = generateMcpToken(MCP_OAUTH_ACCESS_PREFIX);
  const refresh = generateMcpToken(MCP_OAUTH_REFRESH_PREFIX);
  await putAccess(deps.doc, deps.tables.McpTokens, {
    tokenHash: accessKey(access),
    tokenId: randomUUID(),
    kind: "oauth_access",
    familyId: family.tokenId,
    clientId: family.clientId ?? "",
    scopes,
    expiresAt: accessExpiry,
    ttl: epochSeconds(accessExpiry, DAY_MS),
  });
  const rt: RefreshItem = {
    pk: grantKey("rt", refresh),
    status: "active",
    familyId: family.tokenId,
    clientId: family.clientId ?? "",
    expiresAt: familyExpiry,
    ttl: epochSeconds(familyExpiry, DAY_MS),
  };
  await putGrantItem(deps.doc, deps.config.grantsTable, rt);
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: Math.max(1, Math.floor((Date.parse(accessExpiry) - now.getTime()) / 1000)),
    refresh_token: refresh,
    scope: scopes.join(" "),
  };
}

async function exchangeAuthorizationCode(
  event: APIGatewayProxyEventV2,
  form: URLSearchParams,
  client: OAuthClient,
  deps: OAuthDeps,
): Promise<Result> {
  const code = single(form, "code");
  const redirectUri = single(form, "redirect_uri");
  const verifier = single(form, "code_verifier");
  if (!code || !redirectUri || !isPkceVerifier(verifier)) {
    return oauthError(400, "invalid_request", "code, redirect_uri and code_verifier are required");
  }
  const resource = single(form, "resource");
  if (resource === null || (resource && !isOwnResource(resource, originOf(event, deps.config)))) {
    return oauthError(400, "invalid_target", "resource must be this MCP server");
  }

  const now = deps.now();
  // 단일 사용: active → used 조건부 전이에 성공한 요청만 토큰을 받는다.
  const item = await transitionGrantItem<CodeItem>({
    doc: deps.doc,
    table: deps.config.grantsTable,
    pk: grantKey("code", code),
    attr: "status",
    from: "active",
    to: "used",
  });
  const invalid = () => oauthError(400, "invalid_grant", "authorization code is invalid or expired");
  if (!item || item.expiresAt <= now.toISOString()) return invalid();
  if (item.clientId !== client.clientId || item.redirectUri !== redirectUri) return invalid();
  if (!verifyPkceS256(verifier, item.codeChallenge)) return invalid();

  const familyId = randomUUID();
  const expiresAt = daysFrom(now, item.grantDays);
  const family: McpTokenRecord & { ttl: number } = {
    tokenHash: familyKey(familyId),
    tokenId: familyId,
    kind: "oauth",
    clientId: client.clientId,
    memberId: item.memberId,
    name: client.clientName,
    scopes: item.scopes,
    workspaceIds: item.workspaceIds,
    tokenHint: "",
    createdAt: now.toISOString(),
    expiresAt,
    lastUsedAt: null,
    revokedAt: null,
    // 만료 후 일주일 뒤 목록에서도 정리된다.
    ttl: epochSeconds(expiresAt, 7 * DAY_MS),
  };
  await putFamily(deps.doc, deps.tables.McpTokens, family);
  return tokenJson(await issuePair(deps, family, item.scopes, now));
}

async function exchangeRefreshToken(form: URLSearchParams, client: OAuthClient, deps: OAuthDeps): Promise<Result> {
  const raw = single(form, "refresh_token");
  if (!raw) return oauthError(400, "invalid_request", "refresh_token is required");
  const invalid = () => oauthError(400, "invalid_grant", "refresh token is invalid or expired");
  if (!isMcpTokenFormat(raw, MCP_OAUTH_REFRESH_PREFIX)) return invalid();

  const now = deps.now();
  const nowIso = now.toISOString();
  const pk = grantKey("rt", raw);
  const current = await getGrantItem<RefreshItem>(deps.doc, deps.config.grantsTable, pk);
  if (!current || current.clientId !== client.clientId || current.expiresAt <= nowIso) return invalid();

  const rotated = await transitionGrantItem<RefreshItem>({
    doc: deps.doc,
    table: deps.config.grantsTable,
    pk,
    attr: "status",
    from: "active",
    to: "used",
    set: { usedAt: nowIso },
  });
  if (!rotated) {
    // 이미 회전된 refresh token 재사용 — 탈취 가능성이 있으므로 family 전체를 폐기한다.
    console.warn("oauth refresh token 재사용 감지 — family 폐기", { familyId: current.familyId });
    await revokeFamily(deps.doc, deps.tables.McpTokens, current.familyId, nowIso);
    return invalid();
  }

  const family = await getFamily(deps.doc, deps.tables.McpTokens, current.familyId);
  if (!family || !isMcpTokenActive(family, nowIso)) return invalid();

  const scopeRaw = single(form, "scope");
  let scopes = family.scopes;
  if (scopeRaw) {
    const requested = scopeRaw.split(" ").filter(Boolean);
    if (!requested.every((s) => (family.scopes as string[]).includes(s))) {
      return oauthError(400, "invalid_scope", "scope exceeds the original grant");
    }
    scopes = family.scopes.filter((s) => requested.includes(s));
  }
  return tokenJson(await issuePair(deps, family, scopes, now));
}

/** 공통 전처리 — IP 상한, form 본문, public client 식별. */
async function prepare(
  event: APIGatewayProxyEventV2,
  deps: OAuthDeps,
): Promise<{ ok: true; form: URLSearchParams; client: OAuthClient } | { ok: false; res: Result }> {
  const allowed = await consumeIpQuota({
    doc: deps.doc,
    table: deps.tables.RateLimit,
    key: `token#${clientIp(event)}`,
    windowSec: 60,
    limit: TOKEN_LIMIT_PER_MIN,
    nowMs: deps.now().getTime(),
  });
  if (!allowed) return { ok: false, res: oauthError(429, "too_many_requests", "rate limit exceeded") };
  if (!isFormRequest(event)) {
    return { ok: false, res: oauthError(400, "invalid_request", "content-type must be application/x-www-form-urlencoded") };
  }
  // public 클라이언트만 등록되므로 client_secret·Basic 인증은 지원하지 않는다.
  if (header(event, "authorization")) return { ok: false, res: oauthError(401, "invalid_client", "client authentication not supported") };
  const form = parseForm(event);
  const clientId = single(form, "client_id");
  const client = clientId ? await getClient(deps.doc, deps.config.clientsTable, clientId) : null;
  if (!client) return { ok: false, res: oauthError(401, "invalid_client", "unknown client") };
  return { ok: true, form, client };
}

export async function handleToken(event: APIGatewayProxyEventV2, deps: OAuthDeps): Promise<Result> {
  const prep = await prepare(event, deps);
  if (!prep.ok) return prep.res;
  const grantType = single(prep.form, "grant_type");
  if (grantType === "authorization_code") return exchangeAuthorizationCode(event, prep.form, prep.client, deps);
  if (grantType === "refresh_token") return exchangeRefreshToken(prep.form, prep.client, deps);
  return oauthError(400, "unsupported_grant_type", "supported: authorization_code, refresh_token");
}

/** RFC 7009 — 토큰 종류와 무관하게 해당 family 를 폐기한다. 알 수 없는 토큰도 200. */
export async function handleRevoke(event: APIGatewayProxyEventV2, deps: OAuthDeps): Promise<Result> {
  const prep = await prepare(event, deps);
  if (!prep.ok) return prep.res;
  const raw = single(prep.form, "token");
  if (!raw) return oauthError(400, "invalid_request", "token is required");

  let target: { familyId: string; clientId: string } | null = null;
  if (isMcpTokenFormat(raw, MCP_OAUTH_REFRESH_PREFIX)) {
    target = await getGrantItem<RefreshItem>(deps.doc, deps.config.grantsTable, grantKey("rt", raw));
  } else if (isMcpTokenFormat(raw, MCP_OAUTH_ACCESS_PREFIX)) {
    target = await getAccess(deps.doc, deps.tables.McpTokens, raw);
  }
  if (target && target.clientId === prep.client.clientId) {
    await revokeFamily(deps.doc, deps.tables.McpTokens, target.familyId, deps.now().toISOString());
  }
  return tokenJson({});
}
