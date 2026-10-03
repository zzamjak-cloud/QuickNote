// MCP 개인 액세스 토큰 GraphQL 쿼리/뮤테이션. 토큰 원문은 CREATE 응답에만 존재한다.

const MCP_TOKEN_FIELDS = `
  tokenId kind name scopes workspaceIds tokenHint createdAt expiresAt lastUsedAt revokedAt
`;

export const LIST_MCP_TOKENS = `
  query ListMcpTokens {
    listMcpTokens { ${MCP_TOKEN_FIELDS} }
  }
`;

export const CREATE_MCP_TOKEN = `
  mutation CreateMcpToken($input: CreateMcpTokenInput!) {
    createMcpToken(input: $input) { token ${MCP_TOKEN_FIELDS} }
  }
`;

export const REVOKE_MCP_TOKEN = `
  mutation RevokeMcpToken($tokenId: ID!) {
    revokeMcpToken(tokenId: $tokenId) { ${MCP_TOKEN_FIELDS} }
  }
`;
