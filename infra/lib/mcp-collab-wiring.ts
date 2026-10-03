// SyncStack(McpServerFn) ↔ RealtimeCollabStack(WS API) 연결 규약 — 명명 규칙으로 잇는다.
// RealtimeCollabStack 은 이미 SyncStack 을 교차참조하므로 역방향(Sync → Realtime 의 API id) 참조는 순환이 된다.
// 그래서 Realtime 스택이 (1) WS 관리 엔드포인트를 SSM 파라미터로 게시하고 (2) 고정 이름의 MCP 역할에
// ManageConnections·파라미터 읽기 정책을 붙인다. 배포 순서: Sync(역할 생성) → Realtime(정책 부착).

/** McpServerFn 실행 역할 이름(계정 내 env 별 고유). */
export function mcpServerRoleName(envPrefix: string): string {
  return `${envPrefix}quicknote-mcp-server`;
}

/** WS 관리 엔드포인트(https://{apiId}.execute-api.{region}.amazonaws.com/{stage}) SSM 파라미터 이름. */
export function collabWsEndpointParamName(envPrefix: string): string {
  return `/${envPrefix}quicknote/collab-ws-management-endpoint`;
}
