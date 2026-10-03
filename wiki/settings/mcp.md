# 설정 — AI 연결(MCP) 탭

설정 모달의 "AI 연결 (MCP)" 탭 — Claude Code·Cursor 등 외부 AI 가 MCP 로 QuickNote 에 접근할 때 쓰는 **개인 액세스 토큰(PAT)** 을 발급·조회·폐기한다. 전 역할에 노출(토큰은 발급자 본인 권한 범위 안에서만 동작). 설계 배경은 `Plan/MCP_구현계획.md` §3.1.

## 관련 파일

| 파일 | 역할 |
|------|------|
| `src/components/settings/McpSettingsTab.tsx` | 탭 본체 — 목록·폐기 확인(`SimpleConfirmDialog`)·발급 흐름 |
| `src/components/settings/McpTokenCreateForm.tsx` | 발급 폼(이름·권한·워크스페이스 범위·만료) |
| `src/components/settings/McpTokenCreatedPanel.tsx` | 발급 직후 원문 1회 표시 + 연결 스니펫(Claude Code / JSON) 복사 |
| `src/lib/sync/mcpTokenApi.ts` | GraphQL 래퍼 + `getMcpServerUrl()`(`VITE_MCP_SERVER_URL`) |
| `src/lib/sync/queries/mcp.ts` | GraphQL operations |
| `infra/lambda/v5-resolvers/handlers/mcpToken.ts` | 서버 resolver(해시 저장·본인 토큰만 조회/폐기) |

## GraphQL

| 작업 | 설명 |
|------|------|
| `listMcpTokens` | 본인 토큰 메타 목록(원문·해시 없음) |
| `createMcpToken(input: {name, scopes, workspaceIds, expiresInDays})` | 발급. 응답 `token` 에만 원문 포함 |
| `revokeMcpToken(tokenId)` | 즉시 무효화. 갱신된 메타 반환 → 목록에 "폐기됨" 표시 |

- `workspaceIds: []` = 접근 가능한 전체 워크스페이스. 스케줄러 가상 WS·삭제된 WS 는 선택지에서 제외.
- `scopes` 는 현재 `["read"]` 만 선택 가능. "읽기+쓰기" 는 P2 쓰기 툴 전까지 비활성("곧 지원").
- `expiresInDays`: 30/90(기본)/365, 무기한은 `null`.

## 보안 규칙 (회귀 금지)

- **원문은 발급 직후 한 번만** 보여 준다. 패널 "닫기" 시 컴포넌트 상태에서 원문을 지우며, 목록 상태에는 원문을 넣지 않는다(`{ token, ...meta }` 분리).
- 서버는 SHA-256 **해시만 저장**하고 어떤 조회 응답에도 원문·해시를 싣지 않는다. 식별은 `tokenHint`(마지막 4글자, `…abcd`)로만.
- 원문을 store·localStorage·로그에 남기지 않는다.

## MCP 서버 URL

- CDK output `McpServerUrl`(Function URL + `mcp` 경로) 값을 `VITE_MCP_SERVER_URL` 로 주입한다(`.env.example` 참고).
- 미설정 빌드에서는 스니펫에 `<MCP 서버 URL>` 자리표시자와 안내 문구를 표시한다(UI 는 정상 동작).

## 테스트

`src/components/settings/__tests__/McpSettingsTab.test.tsx` — 목록 렌더, 발급 시 원문 1회 표시·닫으면 제거, 폐기 mutation 호출, URL 미설정 자리표시자.
