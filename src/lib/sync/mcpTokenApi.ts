// MCP 개인 액세스 토큰 API 래퍼 — 서버는 해시만 저장하므로 원문은 발급 응답에서 한 번만 받는다.

import { appsyncClient } from "./graphql/client";
import {
  ADMIN_LIST_MCP_TOKENS,
  ADMIN_REVOKE_MCP_TOKEN,
  ADMIN_REVOKE_MCP_TOKENS_BY_MEMBER,
  CREATE_MCP_TOKEN,
  LIST_MCP_TOKENS,
  REVOKE_MCP_TOKEN,
} from "./queries/mcp";

export type McpTokenScope = "read" | "write";

/**
 * MCP 관리자(토큰 관리·공유 워크스페이스 MCP 정책) — developer·owner 만. 앱의 다른 관리 권한(manager 이상 isAdmin)과 별개.
 * 서버(requireMcpTokenAdmin)가 다시 검사하므로 이 판정은 UI 노출용이다.
 */
export function isMcpAdminRole(role: string | null | undefined): boolean {
  return role === "developer" || role === "owner";
}

export type McpToken = {
  tokenId: string;
  /** "oauth" = OAuth 로 연결된 앱(name = 앱 이름). 구버전 응답은 null → PAT. */
  kind?: "pat" | "oauth" | null;
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
  /** 소유자가 아닌 관리자가 강제 폐기했는지. */
  revokedByAdmin?: boolean | null;
  revokeReason?: string | null;
};

export type McpTokenStatus = "active" | "revoked" | "expired";

/** 관리자 토큰 현황 항목(해시·원문 없음). */
export type AdminMcpToken = {
  tokenId: string;
  kind: "pat" | "oauth";
  name: string;
  clientName: string | null;
  memberId: string;
  memberName: string | null;
  memberEmail: string | null;
  scopes: string[];
  workspaceIds: string[];
  workspaces: { workspaceId: string; name: string }[];
  tokenHint: string;
  status: McpTokenStatus;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
};

export type AdminMcpTokenFilter = { memberId?: string; kind?: "pat" | "oauth"; status?: McpTokenStatus };

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

export async function adminListMcpTokensApi(
  filter: AdminMcpTokenFilter,
  nextToken?: string | null,
): Promise<{ items: AdminMcpToken[]; nextToken: string | null }> {
  return callField(ADMIN_LIST_MCP_TOKENS, "adminListMcpTokens", { filter, limit: 100, nextToken: nextToken ?? null });
}

export async function adminRevokeMcpTokenApi(token: Pick<AdminMcpToken, "tokenId" | "memberId">, reason: string): Promise<AdminMcpToken> {
  return callField(ADMIN_REVOKE_MCP_TOKEN, "adminRevokeMcpToken", {
    tokenId: token.tokenId,
    memberId: token.memberId,
    reason: reason || null,
  });
}

export async function adminRevokeMcpTokensByMemberApi(
  memberId: string,
  reason: string,
): Promise<{ memberId: string; revokedCount: number; items: AdminMcpToken[] }> {
  return callField(ADMIN_REVOKE_MCP_TOKENS_BY_MEMBER, "adminRevokeMcpTokensByMember", { memberId, reason: reason || null });
}

/** CDK McpServerUrl output. 미설정 빌드면 빈 문자열. */
export function getMcpServerUrl(): string {
  return ((import.meta.env.VITE_MCP_SERVER_URL as string | undefined) ?? "").trim();
}
