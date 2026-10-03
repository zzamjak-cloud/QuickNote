// OAuth 파사드 HTTP 헬퍼 — Function URL(payload v2) 이벤트 파싱과 응답 생성.
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

export type Result = Exclude<APIGatewayProxyResultV2, string>;

/** 메타데이터·register·token·revoke 만 브라우저 교차 출처 호출을 허용한다(/authorize·/callback·/consent 는 제외). */
export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, mcp-protocol-version",
  "access-control-max-age": "600",
};

const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" };

export function header(event: APIGatewayProxyEventV2, name: string): string | undefined {
  const target = name.toLowerCase();
  const hit = Object.entries(event.headers ?? {}).find(([k]) => k.toLowerCase() === target);
  return hit?.[1];
}

export function decodeBody(event: APIGatewayProxyEventV2): string {
  if (!event.body) return "";
  return event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
}

/** OAuth 요청 본문 상한 — 폼·DCR JSON 모두 작다. */
export const MAX_OAUTH_BODY_BYTES = 16 * 1024;

export function isFormRequest(event: APIGatewayProxyEventV2): boolean {
  return (header(event, "content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded");
}

export function parseForm(event: APIGatewayProxyEventV2): URLSearchParams {
  return new URLSearchParams(decodeBody(event));
}

/** 같은 이름이 두 번 이상 오면(RFC 6749 §3.1 금지) undefined 대신 null 을 돌려 구분한다. */
export function single(params: URLSearchParams, name: string): string | undefined | null {
  const all = params.getAll(name);
  if (all.length > 1) return null;
  return all[0] === undefined || all[0] === "" ? undefined : all[0];
}

export function getCookie(event: APIGatewayProxyEventV2, name: string): string | undefined {
  const raw = [...(event.cookies ?? []), ...(header(event, "cookie") ?? "").split(";")];
  for (const part of raw) {
    const idx = part.indexOf("=");
    if (idx > 0 && part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return undefined;
}

export function clientIp(event: APIGatewayProxyEventV2): string {
  return event.requestContext?.http?.sourceIp ?? "unknown";
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Result {
  return {
    statusCode: status,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

/** RFC 6749 §5.2 오류 응답(no-store, CORS). invalid_client 는 401. */
export function oauthError(status: number, error: string, description?: string): Result {
  return json(status, description ? { error, error_description: description } : { error }, { ...NO_STORE, ...CORS_HEADERS });
}

export function tokenJson(body: unknown): Result {
  return json(200, body, { ...NO_STORE, ...CORS_HEADERS });
}

export function preflight(): Result {
  return { statusCode: 204, headers: { ...CORS_HEADERS }, body: "" };
}

/** redirect_uri 의 기존 쿼리를 보존하며 파라미터를 덧붙인다(undefined 값은 생략). */
export function withParams(uri: string, params: Record<string, string | undefined>): string {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  return url.toString();
}

export function redirect(location: string, opts: { status?: number; cookies?: string[] } = {}): Result {
  return {
    statusCode: opts.status ?? 302,
    headers: { location, ...NO_STORE, "referrer-policy": "no-referrer" },
    cookies: opts.cookies,
    body: "",
  };
}

export function html(status: number, body: string, csp: string, cookies?: string[]): Result {
  return {
    statusCode: status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": csp,
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...NO_STORE,
    },
    cookies,
    body,
  };
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
