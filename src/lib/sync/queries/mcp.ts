// MCP 개인 액세스 토큰 GraphQL 쿼리/뮤테이션. 토큰 원문은 CREATE 응답에만 존재한다.

const MCP_TOKEN_FIELDS = `
  tokenId kind name scopes workspaceIds tokenHint createdAt expiresAt lastUsedAt revokedAt revokedByAdmin revokeReason
`;

const ADMIN_MCP_TOKEN_FIELDS = `
  tokenId kind name clientName memberId memberName memberEmail scopes workspaceIds workspaces { workspaceId name }
  tokenHint status createdAt expiresAt lastUsedAt revokedAt revokedBy revokeReason
`;

export const ADMIN_LIST_MCP_TOKENS = `
  query AdminListMcpTokens($filter: AdminMcpTokenFilter, $limit: Int, $nextToken: String) {
    adminListMcpTokens(filter: $filter, limit: $limit, nextToken: $nextToken) { items { ${ADMIN_MCP_TOKEN_FIELDS} } nextToken }
  }
`;

export const ADMIN_REVOKE_MCP_TOKEN = `
  mutation AdminRevokeMcpToken($tokenId: ID!, $memberId: ID!, $reason: String) {
    adminRevokeMcpToken(tokenId: $tokenId, memberId: $memberId, reason: $reason) { ${ADMIN_MCP_TOKEN_FIELDS} }
  }
`;

export const ADMIN_REVOKE_MCP_TOKENS_BY_MEMBER = `
  mutation AdminRevokeMcpTokensByMember($memberId: ID!, $reason: String) {
    adminRevokeMcpTokensByMember(memberId: $memberId, reason: $reason) { memberId revokedCount items { ${ADMIN_MCP_TOKEN_FIELDS} } }
  }
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
