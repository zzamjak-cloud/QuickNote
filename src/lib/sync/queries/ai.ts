// 워크스페이스 AI 설정·사용량 GraphQL 쿼리/뮤테이션.

const AI_CONFIG_FIELDS = `
  workspaceId enabled provider hasKey apiKeyMasked defaultModel monthlyTokenLimit updatedAt
`;

export const GET_WORKSPACE_AI_CONFIG = `
  query GetWorkspaceAiConfig($workspaceId: ID!) {
    getWorkspaceAiConfig(workspaceId: $workspaceId) { ${AI_CONFIG_FIELDS} }
  }
`;

export const GET_WORKSPACE_AI_USAGE = `
  query GetWorkspaceAiUsage($workspaceId: ID!, $month: String) {
    getWorkspaceAiUsage(workspaceId: $workspaceId, month: $month) {
      workspaceId month inputTokens outputTokens requestCount
      members { memberId inputTokens outputTokens requestCount }
    }
  }
`;

export const SET_WORKSPACE_AI_KEY = `
  mutation SetWorkspaceAiKey($workspaceId: ID!, $provider: String!, $apiKey: String!) {
    setWorkspaceAiKey(workspaceId: $workspaceId, provider: $provider, apiKey: $apiKey) { ${AI_CONFIG_FIELDS} }
  }
`;

export const CLEAR_WORKSPACE_AI_KEY = `
  mutation ClearWorkspaceAiKey($workspaceId: ID!) {
    clearWorkspaceAiKey(workspaceId: $workspaceId) { ${AI_CONFIG_FIELDS} }
  }
`;

export const UPDATE_WORKSPACE_AI_SETTINGS = `
  mutation UpdateWorkspaceAiSettings(
    $workspaceId: ID!
    $enabled: Boolean
    $defaultModel: String
    $monthlyTokenLimit: Int
  ) {
    updateWorkspaceAiSettings(
      workspaceId: $workspaceId
      enabled: $enabled
      defaultModel: $defaultModel
      monthlyTokenLimit: $monthlyTokenLimit
    ) { ${AI_CONFIG_FIELDS} }
  }
`;
