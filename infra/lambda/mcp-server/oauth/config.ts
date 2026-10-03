// OAuth 2.1 파사드 설정 — env 로 주입되며, 하나라도 비면 OAuth 경로 전체를 비활성(404)으로 둔다.
import type { APIGatewayProxyEventV2 } from "aws-lambda";

export type OAuthConfig = {
  /** DCR 로 등록된 클라이언트(PK clientId, TTL ttl). */
  clientsTable: string;
  /** 단명 항목(tx#·code#·rt#) 테이블(PK pk, TTL ttl). */
  grantsTable: string;
  /** Cognito Hosted UI 도메인(https://<prefix>.auth.<region>.amazoncognito.com). */
  cognitoDomain: string;
  userPoolId: string;
  /** 파사드 전용 Cognito 앱 클라이언트 ID 를 담은 SSM 파라미터 이름(스택 순환 참조 회피). */
  cognitoClientIdParam: string;
  /** 테스트·직접 지정용 Cognito 앱 클라이언트 ID(설정 시 SSM 조회 생략). */
  cognitoClientId?: string;
  /** CloudFront·커스텀 도메인을 앞에 둘 때의 공개 origin. 미지정이면 Function URL 호스트. */
  publicOrigin?: string;
};

export function oauthConfigFromEnv(): OAuthConfig {
  const env = (name: string) => process.env[name] ?? "";
  return {
    clientsTable: env("OAUTH_CLIENTS_TABLE_NAME"),
    grantsTable: env("OAUTH_GRANTS_TABLE_NAME"),
    cognitoDomain: env("OAUTH_COGNITO_DOMAIN"),
    userPoolId: env("OAUTH_USER_POOL_ID"),
    cognitoClientIdParam: env("OAUTH_COGNITO_CLIENT_ID_PARAM"),
    cognitoClientId: env("OAUTH_COGNITO_CLIENT_ID") || undefined,
    publicOrigin: env("MCP_PUBLIC_ORIGIN") || undefined,
  };
}

export function isOAuthConfigured(c: OAuthConfig): boolean {
  return Boolean(
    c.clientsTable && c.grantsTable && c.cognitoDomain && c.userPoolId && (c.cognitoClientId || c.cognitoClientIdParam),
  );
}

/** issuer·resource 의 기준 origin. Function URL 의 domainName 은 AWS 가 채우는 값이라 Host 헤더 위조와 무관하다. */
export function originOf(event: APIGatewayProxyEventV2, config: Pick<OAuthConfig, "publicOrigin">): string {
  if (config.publicOrigin) return config.publicOrigin.replace(/\/+$/, "");
  return `https://${event.requestContext?.domainName ?? "localhost"}`;
}

export const MCP_RESOURCE_PATH = "/mcp";
export const PRM_PATH = "/.well-known/oauth-protected-resource";

export function resourceUrl(origin: string): string {
  return `${origin}${MCP_RESOURCE_PATH}`;
}

export function resourceMetadataUrl(origin: string): string {
  return `${origin}${PRM_PATH}${MCP_RESOURCE_PATH}`;
}
