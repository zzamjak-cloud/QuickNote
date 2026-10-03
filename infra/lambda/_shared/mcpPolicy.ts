// 워크스페이스별 MCP 허용 정책 — v5 리졸버(설정)와 MCP 서버(시행)가 같이 쓴다.
// 값이 없으면 "readWrite"(정책 도입 전 동작 유지).
export const MCP_POLICIES = ["disabled", "read", "readWrite"] as const;
export type McpPolicy = (typeof MCP_POLICIES)[number];

export function normalizeMcpPolicy(value: unknown): McpPolicy {
  return (MCP_POLICIES as readonly unknown[]).includes(value) ? (value as McpPolicy) : "readWrite";
}
