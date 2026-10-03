// 메타데이터 문서 — RFC 9728(Protected Resource Metadata) · RFC 8414(Authorization Server Metadata).
// 파사드가 같은 Function URL 에 있으므로 issuer = resource origin.
import { MCP_TOKEN_SCOPES } from "../../_shared/mcpToken";
import { resourceUrl } from "./config";

export function protectedResourceMetadata(origin: string) {
  return {
    resource: resourceUrl(origin),
    authorization_servers: [origin],
    scopes_supported: [...MCP_TOKEN_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "QuickNote",
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    revocation_endpoint: `${origin}/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...MCP_TOKEN_SCOPES],
    authorization_response_iss_parameter_supported: true,
  };
}
