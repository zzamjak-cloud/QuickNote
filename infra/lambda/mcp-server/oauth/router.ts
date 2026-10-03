// OAuth 파사드 라우터 — MCP Function URL 의 OAuth 경로만 처리하고, 그 외 경로는 null 로 넘긴다.
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handleAuthorize, handleCallback, handleConsent } from "./authorize";
import { defaultCognitoOps, type CognitoOps } from "./cognito";
import { isOAuthConfigured, oauthConfigFromEnv, originOf, PRM_PATH, resourceMetadataUrl, type OAuthConfig } from "./config";
import { errorPage } from "./consentPage";
import type { OAuthDeps } from "./deps";
import { CORS_HEADERS, decodeBody, json, MAX_OAUTH_BODY_BYTES, oauthError, preflight, type Result } from "./http";
import { authorizationServerMetadata, protectedResourceMetadata } from "./metadata";
import { handleRegister } from "./register";
import { handleRevoke, handleToken } from "./token";

type Route = {
  method: "GET" | "POST";
  /** 브라우저 교차 출처 호출 허용(메타데이터·register·token·revoke). */
  cors: boolean;
  /** 사람이 보는 HTML 경로 — 오류도 HTML 로 응답한다. */
  browser: boolean;
  run: (event: APIGatewayProxyEventV2, deps: OAuthDeps) => Promise<Result>;
};

const metadataRoute = (doc: (origin: string) => unknown): Route => ({
  method: "GET",
  cors: true,
  browser: false,
  run: async (event, deps) =>
    json(200, doc(originOf(event, deps.config)), { "cache-control": "public, max-age=300", ...CORS_HEADERS }),
});

const ROUTES: Record<string, Route> = {
  [PRM_PATH]: metadataRoute(protectedResourceMetadata),
  [`${PRM_PATH}/mcp`]: metadataRoute(protectedResourceMetadata),
  "/.well-known/oauth-authorization-server": metadataRoute(authorizationServerMetadata),
  "/register": { method: "POST", cors: true, browser: false, run: handleRegister },
  "/token": { method: "POST", cors: true, browser: false, run: handleToken },
  "/revoke": { method: "POST", cors: true, browser: false, run: handleRevoke },
  "/authorize": { method: "GET", cors: false, browser: true, run: handleAuthorize },
  "/callback": { method: "GET", cors: false, browser: true, run: handleCallback },
  "/consent": { method: "POST", cors: false, browser: true, run: handleConsent },
};

export type OAuthRouterDeps = Pick<OAuthDeps, "doc" | "tables"> & Partial<Omit<OAuthDeps, "doc" | "tables">>;

let envConfig: OAuthConfig | null = null;
let defaultCognito: { config: OAuthConfig; ops: CognitoOps } | null = null;

/** env 설정은 컨테이너당 한 번 읽는다(Cognito 클라이언트 ID SSM 캐시를 유지하기 위해 같은 객체를 쓴다). */
function configOf(deps: Partial<Pick<OAuthDeps, "config">>): OAuthConfig {
  return deps.config ?? (envConfig ??= oauthConfigFromEnv());
}

function resolveDeps(deps: OAuthRouterDeps): OAuthDeps | null {
  const config = configOf(deps);
  if (!isOAuthConfigured(config)) return null;
  let cognito = deps.cognito;
  if (!cognito) {
    if (defaultCognito?.config !== config) defaultCognito = { config, ops: defaultCognitoOps(config) };
    cognito = defaultCognito.ops;
  }
  return { doc: deps.doc, tables: deps.tables, config, cognito, now: deps.now ?? (() => new Date()) };
}

export function isOAuthPath(path: string): boolean {
  return Object.prototype.hasOwnProperty.call(ROUTES, path);
}

/** OAuth 가 설정돼 있을 때 /mcp 401 의 WWW-Authenticate 에 실을 resource_metadata URL. */
export function resourceMetadataFor(event: APIGatewayProxyEventV2, deps: Partial<Pick<OAuthDeps, "config">> = {}): string | null {
  const config = configOf(deps);
  return isOAuthConfigured(config) ? resourceMetadataUrl(originOf(event, config)) : null;
}

/** OAuth 경로면 응답, 아니거나 OAuth 미설정이면 null(호출측이 기존 404 처리). */
export async function routeOAuth(event: APIGatewayProxyEventV2, rawDeps: OAuthRouterDeps): Promise<Result | null> {
  const route = ROUTES[event.rawPath];
  if (!route) return null;
  const deps = resolveDeps(rawDeps);
  if (!deps) return null;

  const method = event.requestContext.http.method.toUpperCase();
  if (method === "OPTIONS" && route.cors) return preflight();
  if (method !== route.method) {
    return { statusCode: 405, headers: { allow: route.method, ...(route.cors ? CORS_HEADERS : {}) }, body: "" };
  }
  if (Buffer.byteLength(decodeBody(event), "utf8") > MAX_OAUTH_BODY_BYTES) {
    return route.browser ? errorPage(413, "요청이 너무 큽니다.") : oauthError(413, "invalid_request", "body too large");
  }
  try {
    return await route.run(event, deps);
  } catch (err) {
    // 토큰·코드 원문이 섞이지 않도록 메시지·이름만 남긴다.
    console.error("oauth 요청 처리 실패", { path: event.rawPath, name: (err as Error)?.name, message: (err as Error)?.message });
    return route.browser ? errorPage(500, "일시적인 오류가 발생했습니다.") : oauthError(500, "server_error");
  }
}
