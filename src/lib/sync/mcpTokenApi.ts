// MCP 개인 액세스 토큰 API 래퍼 — 서버는 해시만 저장하므로 원문은 발급 응답에서 한 번만 받는다.

import { appsyncClient } from "./graphql/client";
import { CREATE_MCP_TOKEN, LIST_MCP_TOKENS, REVOKE_MCP_TOKEN } from "./queries/mcp";

export type McpTokenScope = "read" | "write";

export type McpToken = {
  tokenId: string;
  name: string;
  scopes: string[];
  /** 빈 배열 = 접근 가능한 전체 워크스페이스. */
  workspaceIds: string[];
  /** 원문 마지막 4글자. */
  tokenHint: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type CreatedMcpToken = McpToken & { token: string };

export type CreateMcpTokenInput = {
  name: string;
  scopes: McpTokenScope[];
  workspaceIds: string[];
  /** null = 만료 없음. */
  expiresInDays: number | null;
};

type GqlEnvelope<T> = {
  data?: Record<string, T | undefined>;
  errors?: Array<{ message?: string }>;
};

async function callField<T>(
  query: string,
  fieldName: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const result = (await appsyncClient().graphql({ query, variables })) as GqlEnvelope<T>;
  const message = result.errors?.[0]?.message;
  if (message) throw new Error(message);
  const value = result.data?.[fieldName];
  if (!value) throw new Error(`${fieldName} 응답 없음`);
  return value;
}

export async function listMcpTokensApi(): Promise<McpToken[]> {
  return callField(LIST_MCP_TOKENS, "listMcpTokens");
}

export async function createMcpTokenApi(input: CreateMcpTokenInput): Promise<CreatedMcpToken> {
  return callField(CREATE_MCP_TOKEN, "createMcpToken", { input });
}

export async function revokeMcpTokenApi(tokenId: string): Promise<McpToken> {
  return callField(REVOKE_MCP_TOKEN, "revokeMcpToken", { tokenId });
}

/** CDK McpServerUrl output. 미설정 빌드면 빈 문자열. */
export function getMcpServerUrl(): string {
  return ((import.meta.env.VITE_MCP_SERVER_URL as string | undefined) ?? "").trim();
}
