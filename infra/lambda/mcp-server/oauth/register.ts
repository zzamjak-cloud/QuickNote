// RFC 7591 동적 클라이언트 등록 — public 클라이언트(token_endpoint_auth_method=none)만 허용.
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { z } from "zod";
import { MCP_TOKEN_SCOPES } from "../../_shared/mcpToken";
import { randomId } from "./crypto";
import type { OAuthDeps } from "./deps";
import { clientIp, CORS_HEADERS, decodeBody, json, oauthError, type Result } from "./http";
import { CLIENT_TTL_DAYS, consumeIpQuota, daysFrom, epochSeconds, putClient, type OAuthClient } from "./store";

/** IP 당 시간당 등록 상한. */
export const DCR_LIMIT_PER_HOUR = 20;
/** 전역 시간당 등록 상한(IP 분산 남용 방어). env MCP_OAUTH_DCR_GLOBAL_LIMIT(양의 정수) > 기본 500. */
export const DCR_GLOBAL_LIMIT_PER_HOUR = 500;

export function dcrGlobalLimit(): number {
  const n = Number(process.env.MCP_OAUTH_DCR_GLOBAL_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : DCR_GLOBAL_LIMIT_PER_HOUR;
}
const MAX_REDIRECT_URIS = 5;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const SUPPORTED_GRANTS = new Set(["authorization_code", "refresh_token"]);

/** https, 또는 루프백 호스트의 http 만. fragment·userinfo 금지(RFC 6749 §3.1.2). */
export function isAllowedRedirectUri(value: string): boolean {
  if (value.length > 512 || value.includes("#")) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

const registrationSchema = z
  .object({
    redirect_uris: z.array(z.string()).min(1).max(MAX_REDIRECT_URIS),
    client_name: z.string().max(200).optional(),
    token_endpoint_auth_method: z.string().optional(),
    grant_types: z.array(z.string()).optional(),
    response_types: z.array(z.string()).optional(),
    scope: z.string().optional(),
  })
  .passthrough();

function sanitizeName(value: string | undefined): string {
  // 제어 문자 제거 — 동의 화면 표시용(HTML 이스케이프는 렌더 시 별도).
  const cleaned = Array.from(value ?? "")
    .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f)
    .join("")
    .trim()
    .slice(0, 100);
  return cleaned || "MCP 클라이언트";
}

export async function handleRegister(event: APIGatewayProxyEventV2, deps: OAuthDeps): Promise<Result> {
  const now = deps.now();
  const quota = (key: string, limit: number) =>
    consumeIpQuota({ doc: deps.doc, table: deps.tables.RateLimit, key, windowSec: 3600, limit, nowMs: now.getTime() });
  // IP 상한을 먼저 확인해 한 IP 의 남용이 전역 카운터를 소모하지 않게 한다.
  const allowed = (await quota(`dcr#${clientIp(event, deps.config)}`, DCR_LIMIT_PER_HOUR)) && (await quota("dcr-global", dcrGlobalLimit()));
  if (!allowed) return oauthError(429, "too_many_requests", "registration rate limit exceeded");

  let body: unknown;
  try {
    body = JSON.parse(decodeBody(event) || "null");
  } catch {
    return oauthError(400, "invalid_client_metadata", "body must be JSON");
  }
  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) return oauthError(400, "invalid_client_metadata", "invalid client metadata");
  const meta = parsed.data;

  if (!meta.redirect_uris.every(isAllowedRedirectUri)) {
    return oauthError(400, "invalid_redirect_uri", "redirect_uris must be https or loopback http");
  }
  if (meta.token_endpoint_auth_method !== undefined && meta.token_endpoint_auth_method !== "none") {
    return oauthError(400, "invalid_client_metadata", "only public clients (token_endpoint_auth_method=none)");
  }
  if (meta.grant_types && !meta.grant_types.every((g) => SUPPORTED_GRANTS.has(g))) {
    return oauthError(400, "invalid_client_metadata", "unsupported grant_types");
  }
  if (meta.response_types && !meta.response_types.every((r) => r === "code")) {
    return oauthError(400, "invalid_client_metadata", "unsupported response_types");
  }
  if (meta.scope && !meta.scope.split(" ").every((s) => (MCP_TOKEN_SCOPES as readonly string[]).includes(s))) {
    return oauthError(400, "invalid_client_metadata", "unsupported scope");
  }

  const nowIso = now.toISOString();
  const client: OAuthClient = {
    clientId: `qnc_${randomId(24)}`,
    clientName: sanitizeName(meta.client_name),
    redirectUris: Array.from(new Set(meta.redirect_uris)),
    createdAt: nowIso,
    lastUsedAt: nowIso,
    ttl: epochSeconds(daysFrom(now, CLIENT_TTL_DAYS)),
  };
  await putClient(deps.doc, deps.config.clientsTable, client);

  return json(
    201,
    {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(now.getTime() / 1000),
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: MCP_TOKEN_SCOPES.join(" "),
    },
    { "cache-control": "no-store", ...CORS_HEADERS },
  );
}
