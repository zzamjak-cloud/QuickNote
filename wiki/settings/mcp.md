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
- `scopes`: "읽기" = `["read"]`, "읽기+쓰기" = `["read","write"]`. 쓰기를 고르면 폼에 경고(편집·휴지통 이동 가능, 영구삭제 불가, 본문 교체 전 버전 저장)를 띄운다.
- `expiresInDays`: 30/90(기본)/365, 무기한은 `null`.

## 관리자 토큰 관리 (MCP 관리자 = developer·owner)

### 권한 표

| 작업 | developer | owner | leader·manager | member | 비고 |
|---|---|---|---|---|---|
| 본인 토큰 발급·조회·폐기 | ○ | ○ | ○ | ○ | `createMcpToken`·`listMcpTokens`·`revokeMcpToken` |
| 전 멤버 토큰 조회 `adminListMcpTokens` | ○ | ○ | ✕ | ✕ | |
| 강제 폐기·일괄 폐기 | ○ | ○(developer 토큰 제외) | ✕ | ✕ | 소유자 rank > 호출자 rank 면 거부, 같은 rank 허용, 본인 토큰 항상 허용 |
| 공유 워크스페이스 MCP 정책 | ○ | ○ | ✕ | ✕ | 앱의 다른 워크스페이스 설정(updateWorkspace 등, manager 이상)과 별개 |
| 개인 워크스페이스 MCP 정책 | 소유자 | 소유자 | 소유자 | 소유자 | 역할 무관, 본인 개인 WS 만 |

rank 는 `_auth.ts` `ROLE_RANK`(developer 5 > owner 4 > leader 3 > manager 2 > member 1). 따라서 owner 는 developer 의 토큰을 폐기할 수 없고, developer 는 owner 의 토큰을 폐기할 수 있다.

- **MCP 관리자 판정**(사용자 결정): developer·owner 만 — 서버 `requireMcpTokenAdmin` = `requireOwnerOrAbove`, 프론트 `isMcpAdminRole`(`mcpTokenApi.ts`). 설정 모달의 관리 탭 기준 `isAdmin`(manager 이상)을 쓰지 않는다. "토큰 관리" 섹션·워크스페이스 편집 모달의 MCP 정책 선택은 MCP 관리자에게만 보인다. 서버가 다시 검사한다.
- `adminListMcpTokens(filter: {memberId, kind: pat|oauth, status: active|revoked|expired}, limit≤100, nextToken)` — mcp-tokens Scan(작은 테이블, 페이지네이션). **PAT 와 OAuth grant(`oauth-family#`) 만**: 단명 access token(`oat#`) 항목은 스캔 필터와 코드 양쪽에서 제외, 해시는 응답에 없다. 멤버 이름·이메일, 워크스페이스 이름, 상태, `revokedBy`·`revokeReason` 포함.
- `adminRevokeMcpToken(tokenId, memberId, reason?)` — PAT 즉시 폐기, OAuth 는 family 레코드 폐기 = 그 연결의 access·refresh 전부 거부. 클라가 목록 항목의 `memberId` 를 함께 보내고 서버는 byMember GSI 로 그 멤버 토큰만 읽어 tokenId 를 검증한다(테이블 Scan·tokenId GSI 없음, 소유자 불일치는 not found).
- **역할 위계**(회귀 금지): 대상 토큰 소유자의 `ROLE_RANK` 가 호출자보다 **높으면** 단건·일괄 모두 forbidden(일괄은 아무것도 폐기하지 않음). 같은 rank 는 허용, 본인 토큰은 항상 허용. `revokedBy`(관리자)·`revokeReason` 기록 + 감사 로그 `{evt:"mcp.admin.revoke", adminMemberId, tokenId, kind, ownerMemberId, reason}`.
- `adminRevokeMcpTokensByMember(memberId, reason?)` — 그 멤버의 활성 PAT·OAuth 연결 일괄 폐기(byMember GSI).
- 본인 `listMcpTokens` 에 `revokedByAdmin`(폐기자 ≠ 소유자)·`revokeReason` — 목록에 "관리자에 의해 폐기됨"·사유 표시.
- UI: AI 연결(MCP) 탭 하단 "토큰 관리"(`McpAdminTokensSection`) — 구성원·종류·상태 필터, 강제 폐기(사유 입력 다이얼로그), 구성원 선택 시 일괄 폐기, 더 보기.

### 퇴사자 처리 절차

1. 설정 > AI 연결(MCP) > 토큰 관리 → 구성원 필터에서 대상 선택 → "이 구성원의 토큰·연결 모두 폐기"(사유 예: 퇴사). 즉시 PAT·OAuth 연결이 모두 401.
2. 구성원 관리에서 멤버 제거(`removeMember` → status removed). 제거된 멤버의 토큰은 인증 단계(`member inactive`)에서도 거부되지만, 1 을 먼저 해 두면 감사 로그·목록에 폐기 사유가 남는다.
3. 필요하면 상태 "활성" 필터로 남은 토큰이 없는지 확인.

## 워크스페이스 MCP 허용 정책

- Workspace `mcpPolicy: "disabled" | "read" | "readWrite"`(미설정 = readWrite, 정책 도입 전 동작). `setWorkspaceMcpPolicy(workspaceId, policy)` — 공유 워크스페이스는 **MCP 관리자(developer·owner)**, **개인 워크스페이스는 소유자 본인만**(역할 무관), LC 스케줄러 가상 WS 는 거부. 개인 판별은 `type` 이 있으면 그 값, 없는 레거시 행은 personalWorkspaceId 매칭(호출자 본인 또는 소유자 멤버의 personalWorkspaceId)으로 한다.
- 시행(MCP 서버 `workspacePolicy.ts` → `access.ts`·`writeAccess.ts`):
  - `disabled`: MCP 에서 존재하지 않는 것처럼 — list_workspaces·search 대상에서 빠지고 fetch·query·get_comments·get_users(워크스페이스 지정) 등 직접 접근은 not found. PAT 발급 시 범위로도 고를 수 없다(서버 거부).
  - `read`: 모든 쓰기 툴이 `workspace MCP policy is read-only`. list_workspaces 결과에 `mcpPolicy: "read"`.
  - 워크스페이스 레코드는 요청 안에서 한 번만 읽고(요청 캐시), 요청 사이 컨테이너 캐시는 15초 — 정책 변경은 늦어도 30초 안에 반영된다.
- UI: 워크스페이스 관리 > 편집 모달의 "AI 연결(MCP) 허용"(즉시 저장), 개인 워크스페이스는 AI 연결(MCP) 탭의 "내 개인 워크스페이스". 토큰 발급 폼·OAuth 동의 화면은 disabled 를 빼고 read 에 "읽기 전용" 표시.

## 보안 규칙 (회귀 금지)

- **원문은 발급 직후 한 번만** 보여 준다. 패널 "닫기" 시 컴포넌트 상태에서 원문을 지우며, 목록 상태에는 원문을 넣지 않는다(`{ token, ...meta }` 분리).
- 서버는 SHA-256 **해시만 저장**하고 어떤 조회 응답에도 원문·해시를 싣지 않는다. 식별은 `tokenHint`(마지막 4글자, `…abcd`)로만.
- 원문을 store·localStorage·로그에 남기지 않는다.

## MCP 서버 URL

- CDK output `McpServerUrl`(**CloudFront** `https://xxxx.cloudfront.net/mcp`) 값을 `VITE_MCP_SERVER_URL` 로 주입한다(`.env.example` 참고). `McpServerOriginUrl`(Function URL)은 원본 보호 때문에 직접 호출하면 403 이다.

### CloudFront 앞단 (P4-B, `infra/lib/mcp-edge-construct.ts`)

- **왜**: Lambda Function URL 은 응답의 `WWW-Authenticate` 를 `x-amzn-Remapped-WWW-Authenticate` 로 바꿔 내보내 MCP 클라이언트가 401 에서 OAuth discovery 를 못 한다.
- **WWW-Authenticate 복원**(회귀 주의):
  - viewer-response CloudFront Function 은 **원본이 400 이상을 돌려주면 실행되지 않는다**(AWS 제약, dev 실측) — 401 복원에 못 쓰므로 제거했다. Lambda@Edge 는 쓰지 않는다.
  - 대신 `/mcp` 전용 동작에 **응답 헤더 정책**(`{envPrefix}quicknote-mcp-challenge`)을 붙인다. 문서: "CloudFront adds these headers to every response that it returns to viewers"(상태 코드 예외 없음). 커스텀 헤더 `WWW-Authenticate: Bearer realm="quicknote", resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp"`(override=false — 원본이 직접 보내면 그 값) + `x-amzn-remapped-www-authenticate` 제거. 200 응답에도 붙지만 클라는 401 에서만 해석한다.
  - resource_metadata 는 절대 URL 이라 배포 도메인이 필요한데 정책 → 배포 도메인 → 배포 → 정책 **순환**이다. 그래서 이미 배포된 도메인을 설정값으로 받는다: env `MCP_PUBLIC_ORIGIN` > `-c mcpPublicOrigin=` > `KNOWN_MCP_PUBLIC_ORIGINS`(dev = `https://dbeovncdo410b.cloudfront.net`). 형식(`https://xxxx.cloudfront.net`)이 아니면 synth 실패. output `McpPublicOriginHint` 가 `McpServerUrl` 의 origin 과 같은지 배포 후 확인할 것.
  - **신규 환경(live 포함)**: 첫 배포에는 힌트가 없어 정책이 없다 → MCP 스펙의 well-known 폴백(WWW-Authenticate 에 resource_metadata 가 없으면 `/.well-known/oauth-protected-resource/mcp` → `/.well-known/oauth-protected-resource` 탐색)에 의존한다. 배포 후 `McpServerUrl` 의 origin 을 `KNOWN_MCP_PUBLIC_ORIGINS` 에 추가하고 재배포하면 정책이 붙는다. 배포를 지우고 다시 만들면 도메인이 바뀌므로 값을 갱신해야 한다.
- 배포: 원본 = Function URL, `CachingDisabled`, `AllViewerExceptHostHeader`, 메서드 ALL, 압축 끔, HTTP/2, PriceClass_200(한국 엣지 포함).
- **원본 보호**: CloudFront 가 `x-qn-origin-verify` 커스텀 원본 헤더를 붙이고, 함수는 그 값이 비밀과 일치할 때만 처리(불일치·누락 403, DDB 미접근).
  - 값은 Secrets Manager `{envPrefix}quicknote/mcp-origin-verify`(48자 랜덤, 구두점 제외). **저장소가 공개라 결정적 값은 금지** — 누구나 재현해 Function URL 을 직접 호출하며 뷰어 IP 헤더를 위조할 수 있다.
  - CloudFront 원본 헤더에는 CFN 동적 참조(`{{resolve:secretsmanager:…}}`)로 들어가 템플릿에 평문이 없다. 함수 env 에는 비밀 **이름**(`ORIGIN_VERIFY_SECRET_ID`)만 두고 런타임 `GetSecretValue`(그 비밀만 허용)로 읽어 5분 캐시, 못 읽으면 503(fail-closed, 만료된 옛 값으로 허용하지 않음).
  - **교체 절차**(자동 회전 없음): ① Secrets Manager 에서 값 변경(`put-secret-value` 또는 콘솔 "Retrieve/Edit") → ② Sync 스택 재배포(CloudFront 가 동적 참조를 배포 시점에 해석하므로 재배포해야 새 값이 원본 헤더에 들어간다, 배포 전파 수 분) → ③ 함수 캐시 TTL(5분) 경과. ①~③ 사이 옛 값/새 값 불일치 구간에는 403 이 날 수 있으니 트래픽이 적을 때 한다.
- **공개 origin**: 배포 도메인을 함수 env 로 넣으면 순환(배포→URL→함수)이라 SSM `/{envPrefix}quicknote/mcp-public-origin` 에 게시하고 함수가 첫 요청에서 읽어 캐시한다(env `MCP_PUBLIC_ORIGIN_PARAM`; `MCP_PUBLIC_ORIGIN` 이 있으면 우선). 못 읽으면 503 — issuer·resource 가 Function URL 로 잘못 나가지 않게.
- **뷰어 IP**: 관리형 `AllViewerExceptHostHeader` 는 `CloudFront-Viewer-Address` 를 원본에 싣지 않으므로 viewer-request 함수(`viewer-request.js`)가 `x-qn-viewer-address`(ip:0)를 덮어써 싣는다. `clientIp` 는 **그 요청이 origin-verify 를 통과했을 때만**(핸들러가 `viaEdge` 플래그를 OAuth deps 로 전달) `x-qn-viewer-address` → `CloudFront-Viewer-Address` 순으로 신뢰한다.
- 배포 후 `VITE_MCP_SERVER_URL`·기존 커넥터 URL 을 새 `McpServerUrl` 로 바꿔야 한다(구 Function URL 은 403).
- 미설정 빌드에서는 스니펫에 `<MCP 서버 URL>` 자리표시자와 안내 문구를 표시한다(UI 는 정상 동작).

## 쓰기 툴 (P2, `infra/lambda/mcp-server/serverWrite.ts`)

| 툴 | 입력 | 동작 |
|------|------|------|
| `create_pages` | `parent: {pageId}\|{databaseId}\|{workspaceId}`, `pages[1..20]: {title?, icon?, content?(QFM), properties?}` | 형제 끝에 생성. 일반 페이지 제목 중복은 `(1)`… 부여. DB 행 `properties` 는 사람 값 → 셀 변환(`cellInput.ts`) |
| `update_page` | `pageId, title?, icon?(null=제거), properties?, content?: {mode, markdown, anchor?, rangeStart?, rangeEnd?, occurrence?}` | mode = `replace`·`append`·`insert_after`(최상위 블록 텍스트 일치)·`replace_range`(텍스트 접두) |
| `move_pages` | `pageIds[1..20], newParent: {pageId}\|{workspaceId}` | 같은 워크스페이스만, 순환·DB 행 거부 |
| `duplicate_page` | `pageId, includeChildren?: false` | 앱과 같게 자신만 복제, `"{title} (Copy)"`, 원본 다음 순서 |
| `trash_page` | `pageId` | 자손 포함 soft delete(휴지통 30일) + tombstone 발행. DB 행은 DB 룸 rows·rowMembers·rowPageOrder 에서도 제거. **영구삭제 툴 없음** |
| `create_comment` | `pageId, text, blockId?` | 기본은 첫 블록. v5 `upsertComment` 경로 + `publishCommentChanged` |

## DB 툴 (P3)

| 툴 | 입력 | 동작 |
|------|------|------|
| `query_database` (읽기) | `databaseId, filter?: [{column, operator, value?}] (≤20), sorts?: [{column, direction}] (≤5), search?, scope?: {organizationId\|teamId\|projectId\|assigneeId}, limit 1..100, cursor?` | 클라 `src/lib/databaseQuery.ts` `applyFilterSortSearch` 를 **그대로 import**(순수 모듈). 사람 값(옵션 라벨·이메일·YYYY-MM-DD·true/false) → 클라 FilterRule 변환. 행은 `listDatabaseRows`(권한·scope GSI) 로 최대 5000행, 템플릿 제외·order 숫자 정렬(클라 `collectRowPageIdsForDatabases` 와 동일). 결과: 표 + rowIds + nextCursor(오프셋) + truncated |
| `create_database` | `parent: {pageId}\|{workspaceId}, title, layout: inline\|fullPage, titleColumnName?, columns: [{name, type, options?}]` | 앱 흐름: title 컬럼 자동, 컬럼·옵션 id UUID, 옵션 색 `SELECT_COLOR_PRESETS` 순환, 제목 중복은 ` (2)`. inline = 부모 본문 끝 databaseBlock, fullPage = 숨김 홈(`fullPageDatabaseId` 태그·루트·fullPage databaseBlock) + 부모가 있으면 DB 버튼(문단 안 buttonBlock). 앱의 "항목 1" 시드 행은 만들지 않는다 |
| `update_database` | `databaseId, title?, addColumns?, updateColumns?: [{column, name?, type?, addOptions?, renameOptions?}], removeColumns?` | 룸이 시드돼 있으면 클라 `reconcileById` 와 같은 Y 표현(컬럼=Y.Map, 최상위 키 jsonToY)으로 반영 + `upsertDatabase`(바꾼 필드만) + `publishDatabaseChanged`. title 컬럼 삭제·타입 변경 불가, 타입 변경은 앱처럼 값 변환 없음, 삭제 전 `database.checkpoint` 히스토리. 이름 변경은 홈 페이지 제목도 맞춘다(앱 `setDatabaseTitle`). 스케줄러 보호 DB 거부 |

- DB 행 `duplicate_page`: 룸 셀(없으면 Pages.dbCells) 복제, 원본 바로 뒤 order·rowPageOrder, rowMembers 추가. 템플릿 행 거부. `move_pages` 는 DB 행 계속 거부.
- 풀페이지 홈 `update_page`: 제목 = DB 이름 변경, 본문은 DB 뷰라 거부.
- `query_database` 는 앱 `useProcessedRows` 의 전처리(파생·미러 컬럼 값, 사람·연결 페이지 라벨 합성 `withFilterDisplayOptions`)를 하지 않는다 — 사람 필터는 멤버 id/이메일로, 검색은 멤버 이름·연결 페이지 제목에 매치되지 않는다. 미러(`sourceFromDb`) 컬럼은 저장된 값 기준.
- 컬럼 옵션 생략 시 앱 기본값(status 시작전/진행중/완료/보류, select 옵션 1/2), date 는 `{dateShowEnd:true}`. 신규 DB 는 앱처럼 panelState 미전송·presets "[]", 인라인 블록은 `readOnlyTitle:false`.
- 컬럼 삭제 시 행 셀은 지우지 않는다(앱은 지움) — 표시·질의는 컬럼 기준이라 무해, 고아 셀로 남는다. status 컬럼 추가 시 앱의 기존 행 기본값 채우기도 하지 않는다.
- DB 구조 저장·발행(`saveDatabase`)은 룸이 시드돼 있으면 columns·presets·panelState 를 **룸 값**으로 덮는다 — 레코드는 클라 materialize 로 늦게 따라와, 그 값을 발행하면 수신 클라가 "더 새로운 원격 값"으로 룸 최신 컬럼을 지운다.
- 행 스캔(`dbRows.loadDatabaseRows`)은 `listDatabaseRows(projection)` 로 메타·dbCells·scope 키만 읽고(본문 doc 제외), 1000행당 분당 rate limit 1 unit 을 추가 차감한다. 컬럼 삭제 체크포인트의 행 순서는 상한 없이 끝까지 읽는다.
- `upsertDatabase` 는 updatedAt LWW 라 서버 쓰기는 기존 updatedAt 보다 최소 1ms 뒤 시각을 쓴다(`nextUpdatedAt`).
- **빈 DB 룸 시드(dbSeed) 는 바꾸지 않았다**: `rowPageOrder` 가 Database 레코드에 없어 시드는 빈 멤버십이고, 클라는 멤버가 비면 자기 행 순서로 폴백한다. 서버가 GSI 로 멤버를 채우면 부분 로드 클라(행 인덱스 캐시·scope 로드·1000행 상한)의 reconcile 이 미보유 멤버를 "삭제"로 판정할 위험이 있어 보류. 빈 멤버 룸에서는 MCP 가 멤버에 추가하지 않고 순서에만 넣는다.
- **전파**: IAM 전용 `publishPageChanged(input, deletedAt?)`·`publishDatabaseChanged`·`publishCommentChanged`(저장 없음·입력 echo, v5 `publishOnlyResult`). 클라 구독·zod 스키마 그대로 소비(클라 변경 없음) — 휴지통은 tombstone 으로 즉시 제거된다. 페이지 발행은 메타만 싣는다(본문·셀 placeholder).

### 쓰기 안전 규칙 (회귀 금지)

- **인가**: 토큰 `write` scope ∩ 토큰 `workspaceIds` ∩ 멤버 **edit** 권한 ∩ 타인 개인 WS 차단(`writeAccess.ts`). 스케줄러 가상 WS 쓰기 금지. read 토큰은 `token lacks write scope` 툴 오류.
- **본문은 Yjs 룸 경로만**(`collabWriter.ts`): 룸 로드 → update(append) → 룸 연결 브로드캐스트 → 병합 상태를 `upsertPage` 로 materialize(+`publishPageChanged`). `Pages.doc` 직접 기록은 열린 클라가 덮어쓴다.
  - 빈 룸: 서버 `Pages.doc` 을 `seedDocJson`(결정적 시드), placeholder/신규면 `allowEmptyRoom`.
  - 룸이 빈 문단뿐인데 `Pages.doc` 에 본문 → `Pages.doc` 기준 전체 교체로 룸 복구(삽입만 하면 기존 본문이 가려짐).
  - 결과 본문 350KB 초과·본문 전체 비우기(placeholder 가드가 옛 본문을 되살려 룸과 어긋남)는 룸에 쓰기 전에 거부. QFM 입력 512KB 초과는 `INPUT_TOO_LARGE`.
- **QFM 규약**(Plan §10.1): replace 는 현재 본문 `collectBlockRefs` 로만 해석, replace_range 는 교체 구간 블록만, append/insert_after 는 기존 `qn-block` 참조 불가. 결과 문서의 `<database id>` 중복 거부, 새 database 블록은 같은 WS 의 살아 있는 DB 만.
- **epoch 가드**(`epochGuard.ts`): rt-ydoc-updates·rt-ydoc(TTL 없음 — 옛 세대 룸 영구 잔존)·rt-connections(TTL, 활성 신호)를 Limit 100·키 projection 으로 Scan(컨테이너 캐시 10분). 거부(`EPOCH_MISMATCH`): (a) 관측 최대 epoch 이 서버 epoch 보다 큼(클라만 bump), (b) 활성 연결이 있는데 서버 epoch 연결이 없음. 그 외·빈 표본은 허용, 조회 실패는 거부. "서버 epoch 이 관측되는가" 판정은 옛 룸 잔재로 통과하므로 쓰지 않는다. 대상: update_page content/properties, DB 행 create, duplicate. 메타(제목·아이콘·move·trash·comment)·읽기는 대상 아님.
- **일일 쓰기 상한**: 토큰별 UTC 하루 **쓰는 페이지·컬럼 수** 500(env `MCP_DAILY_WRITE_LIMIT`; create_pages·move_pages N, create_database 1+컬럼 수, update_database 변경 수, 나머지 1). ai-usage 원자 카운터 `pk=mcp-wd#<tokenId>#<YYYY-MM-DD>`, TTL 2일. 초과 시 다음 UTC 자정을 담은 툴 오류. read 토큰 호출은 카운트하지 않는다.
- **히스토리**: `replace`·`replace_range` 는 쓰기 전에 현재 협업 본문으로 `page.checkpoint` 버전을 강제 기록(`recordPageHistory force`).
- **DB 행 셀**: DB 룸(`db:<epoch>:<dbId>`)이 시드돼 있으면 `rows` 맵에도 기록(클라 `writeCellsToCollabDoc` 와 같은 구조) 후 `Pages.dbCells` 저장. 빈 룸이면 `Pages.dbCells` 만(첫 진입 `dbSeed` 가 시드). 신규 행은 같은 트랜잭션에서 `rowPageOrder` 끝·`rowMembers`(비어 있지 않을 때만 — 빈 멤버에 새 행만 넣으면 기존 행이 전부 숨는다)에 중복 없이 추가.
- **부분 갱신**: 기존 페이지 저장은 저장 직전 최신 항목을 다시 읽어 툴이 바꾼 필드만 덮고(`patchPage`), `upsertPage(expectedUpdatedAt)` 로 updatedAt 조건부 Put — 충돌 시 1회 재시도 후 오류. 셀은 최신 dbCells 에 병합.
- **입력 형식**: 신규 본문(create·duplicate)도 350KB 상한을 쓰기 전에 전부 검사. `icon` 은 이모지·`quicknote-lucide:<Name>:<hex>`·`quicknote-image://<id>` 만(임의 URL 거부). person 셀은 대상 워크스페이스 접근 멤버만이며 없음·권한 없음은 같은 오류.
- **미지원**: DB 행 이동, 풀페이지 DB 홈 본문 수정·휴지통(DB 삭제는 앱에서).
- **감사**: 툴마다 `{evt:"mcp.tool", tool, tokenId, memberId, ids(pageIds·mode·bytes), ms, ok}` 한 줄. 페이지에는 `lastEditedBy*`(토큰 소유 멤버)·`lastEditSource:"mcp"`.

### WS 브로드캐스트 배선 (스택 간)

RealtimeCollabStack 이 SyncStack 을 이미 참조하므로 역참조는 순환이다 → 명명 규칙(`infra/lib/mcp-collab-wiring.ts`).
- SyncStack: `McpServerFn` 역할 이름 고정(`{envPrefix}quicknote-mcp-server`), rt-* 테이블 권한은 이름 규칙 ARN, env `COLLAB_WS_ENDPOINT_PARAM`.
- RealtimeCollabStack: SSM `/{envPrefix}quicknote/collab-ws-management-endpoint`(= `stage.callbackUrl`) 게시 + 그 역할에 `execute-api:ManageConnections`(해당 API/stage)·`ssm:GetParameter` 정책 부착.
- 배포 순서: **Sync → Realtime**(역할을 Sync 가 만들고 Realtime 이 `Role.fromRoleName` 으로 정책을 붙인다). `fromRoleName` 은 CFN 의존이 없어 역할 이름 변경·Realtime 단독 배포 시 결합이 조용히 끊길 수 있다 — `infra/deploy.md` STEP 3 참고. 엔드포인트를 못 읽으면 브로드캐스트만 생략(룸에는 저장 — 열린 클라는 재연결 hello 때 받음).

## OAuth 2.1 연결 (P4-A, `infra/lambda/mcp-server/oauth/`)

Claude.ai 커스텀 커넥터 등 PAT 를 넣을 수 없는 클라이언트용. MCP Authorization 스펙(2025-06-18)을 따르는 **얇은 파사드**가 McpServerFn 과 **같은 origin(CloudFront)** 에서 동작한다(issuer = resource origin = `McpServerUrl` 의 origin). Cognito 는 DCR 을 지원하지 않으므로 사용자 로그인만 Cognito Hosted UI(Google)에 맡기고, 토큰은 QuickNote 가 직접 발급한다. SDK 의 `mcpAuthRouter` 는 Express 전용이라 쓰지 않고 최소 엔드포인트를 직접 구현했다.

### 연결 방법 (Claude.ai)

설정 → 커넥터 → **사용자 지정 커넥터 추가** → URL 에 `McpServerUrl`(…`/mcp`) 입력 → Google 로그인 → 동의 화면에서 권한(읽기 / 읽기+쓰기)·워크스페이스(미선택 = 전체)·유지 기간(30/90일) 선택 → 승인. 연결된 앱은 설정 > AI 연결(MCP) 목록에 **"연결된 앱"** 배지로 표시되고 "연결 해제"로 즉시 끊는다.

### 흐름

1. `/mcp` 무토큰·무효 토큰 → 401 `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp"`.
2. 클라이언트가 PRM → AS 메타데이터 → `/register`(DCR) → `/authorize`(PKCE S256).
3. `/authorize` 가 tx 를 만들고 `__Host-qn_oauth_tx` 바인딩 쿠키를 심은 뒤 Cognito `/oauth2/authorize`(`identity_provider=Google`, 파사드 전용 앱 클라이언트, Cognito 용 PKCE·nonce)로 보낸다.
4. `/callback`: tx·쿠키 확인 → Cognito 코드 서버 교환 → ID 토큰 검증(aws-jwt-verify, nonce) → `byCognitoSub` 로 Member(active 만) → 동의 화면(서버 렌더, CSRF 토큰).
   - **DCR 피싱 완화(회귀 금지)**: 쓰기를 요청받아도 기본 선택은 "읽기만", 앱 이름 옆 "(앱이 직접 입력한 이름)", redirect 호스트 굵게, claude.ai·claude.com(하위 도메인)·루프백이 아니면 "확인되지 않은 앱 — 이 주소로 권한이 전달됩니다" 경고, 워크스페이스 미선택 = **전체 워크스페이스** 경고.
5. `/consent`(POST): 쿠키·CSRF 확인, tx 단일 사용 → 인가 코드(60초, 단일 사용) → `redirect_uri?code&state&iss` (303).
6. `/token`: `authorization_code`(PKCE·redirect_uri·client 검증) → grant family 생성 + access/refresh 발급. `refresh_token` 은 매번 회전.

### 엔드포인트

| 경로 | 메서드 | 비고 |
|---|---|---|
| `/.well-known/oauth-protected-resource`, `…/mcp` | GET | RFC 9728. `resource=<origin>/mcp`, `authorization_servers=[origin]` |
| `/.well-known/oauth-authorization-server` | GET | RFC 8414. S256 only, auth method `none`, scopes `read write`, `iss` 응답 파라미터 |
| `/register` | POST(JSON) | RFC 7591. public 만(`none`), redirect_uri 는 https 또는 루프백 http(127.0.0.1/localhost/[::1]), fragment·userinfo 금지, 최대 5개. IP 당 시간당 20회 + 전역 시간당 500회(env `MCP_OAUTH_DCR_GLOBAL_LIMIT`). IP 는 origin-verify 를 통과한 요청에서만 CloudFront 뷰어 IP 헤더를 신뢰 |
| `/authorize` | GET | 사용자 인증 전 오류(client·redirect_uri·PKCE·scope·resource·response_type)는 **모두 리다이렉트하지 않고 HTML 400**(RFC 9700 §4.11.2 사전 인증 오픈 리다이렉트 방지). Cognito 로그인 취소도 HTML. 클라이언트로의 error redirect 는 동의 화면 "거부"(access_denied)뿐. `resource` 는 이 서버만. scope 미지정 = read. IP 당 분당 30회 |
| `/callback` | GET | Cognito 콜백 = `<FunctionURL>/callback` |
| `/consent` | POST(form) | 동의 제출 |
| `/token` | POST(form) | IP 당 분당 60회(`/revoke` 공용). `Cache-Control: no-store` |
| `/revoke` | POST(form) | RFC 7009. access·refresh 어느 쪽이든 family 전체 폐기, 모르는 토큰도 200 |

CORS(`*`)는 메타데이터·register·token·revoke 에만. `/authorize`·`/callback`·`/consent` HTML 은 CSP `default-src 'none'; style-src 'sha256-…'; form-action 'self' <redirect origin>; frame-ancestors 'none'; base-uri 'none'` + `X-Frame-Options: DENY`, 스크립트 없음.

### 저장

| 위치 | 키 | 내용 |
|---|---|---|
| `{env}quicknote-mcp-oauth-clients` | `clientId` | DCR 클라이언트. TTL `ttl` 30일, 사용 시(하루 1회) 연장 |
| `{env}quicknote-mcp-oauth-grants` | `pk` | `tx#<id>`(10분, stage login→consent→done) · `code#<sha256>`(60초, active→used) · `rt#<sha256>`(family 만료까지, active→used). TTL `ttl` |
| `{env}quicknote-mcp-tokens` | `oauth-family#<familyId>` | **연결 앱(grant family)** — `kind:"oauth"`, `tokenId=familyId`, memberId·scopes·workspaceIds·expiresAt(30/90일)·clientId·name(앱 이름). byMember GSI 로 설정 목록에 노출 |
| 〃 | `oat#<sha256>` | access token(1시간, `kind:"oauth_access"`, memberId 없음 → GSI 미노출). TTL `ttl` |

- 상태 전이는 모두 조건부 Update(`#s = :from`) — 코드·refresh·tx 동시 사용 중 하나만 성공.
- **refresh 재사용 감지**: 이미 `used` 인 refresh 가 회전 후 **10초 유예**(`REFRESH_REUSE_GRACE_MS`, 네트워크 재시도·동시 요청) 안에 오면 invalid_grant 만, 유예 이후면 family 를 `revokedAt` 으로 폐기 → 그 family 의 모든 access·refresh 가 즉시 거부.
- **인가 코드 재사용**: 코드 항목에 발급한 `familyId` 를 기록해 두고, 이미 쓴 코드가 다시 오면 그 family 를 폐기한다.
- `/mcp` 인증(`auth.ts`): `qn_oat_` → access 항목 → family 레코드를 토큰으로 사용(폐기·만료·멤버 활성 검사 동일). **tokenId = familyId** 라 분당 120회·일일 쓰기 500 상한이 family 단위. scope 는 family ∩ access(refresh 시 축소 가능). 워크스페이스 인가는 PAT 와 같은 `access.ts`/`writeAccess.ts`.
- 설정 탭 `revokeMcpToken(familyId)` 은 family 레코드만 폐기하면 된다. `createMcpToken` 활성 상한 20개는 PAT 만 센다.

### 인프라 (`infra/lib/mcp-oauth-construct.ts`)

- SyncStack 에서 `cognitoDomainPrefix` prop 이 있을 때만 생성(bin 이 전달).
- 파사드 전용 Cognito 앱 클라이언트(`{env}quicknote-mcp-oauth`, public, Google, callback=`<CloudFront origin>/callback`)는 **SyncStack** 에 둔다 — CognitoStack 은 CloudFront 도메인을 알 수 없다. 함수 env 가 클라이언트 ID 를 참조하면 순환(URL→함수→env→클라이언트→URL)이라 SSM `/{envPrefix}quicknote/mcp-oauth-cognito-client-id` 로 게시하고 런타임에 읽는다(권한 ARN 도 이름으로 구성).
- Hosted UI 도메인은 기존 CognitoStack 도메인(`<prefix>.auth.<region>.amazoncognito.com`)을 그대로 쓴다 — 수동 작업 없음.
- mcp-tokens 테이블 TTL(`ttl`) 활성화(escape hatch). PAT 항목에는 `ttl` 이 없어 영향 없음.
- IAM: mcp-tokens `PutItem`(LeadingKeys `oat#*`·`oauth-family#*`)·`UpdateItem`(`oauth-family#*`), ai-usage `UpdateItem`(`mcp-oa#*`), 두 신규 테이블 RW, SSM GetParameter.
- env `MCP_PUBLIC_ORIGIN` 으로 CloudFront·커스텀 도메인 origin 을 지정할 수 있으나, 그 경우 Cognito callback URL 도 같은 origin 으로 바꿔야 한다.

### 알려진 한계

- 커스텀 URI 스킴(`myapp://cb`) redirect 는 DCR 에서 거부한다(https·루프백 http 만). 네이티브 앱은 루프백 리다이렉트를 써야 한다. 스킴을 허용하려면 스킴 하이재킹(다른 앱이 같은 스킴 등록) 위험 때문에 PKCE 외 추가 검증·동의 화면 경고가 필요하다.
- `/mcp` 자체는 CORS 를 열지 않는다(브라우저 MCP Inspector 직접 연결 불가, Claude.ai 는 서버 측 호출이라 무관).

## 비용 절감 (P4-B)

- **메타 스캔 캐시**(`pageScan.scanWorkspaceMetas`): fetch·search·DB 경로 계산의 워크스페이스 메타 Query(최대 5000건)를 컨테이너 캐시(키 = DDB 클라이언트·테이블·워크스페이스, TTL 30초)로 재사용. MCP 쓰기(`upsertAndPublish`·trash)는 해당 워크스페이스를 무효화하고, 쓰기 판단(형제 순서·제목 중복)은 `fresh` 로 캐시를 건너뛴다. ProjectionExpression 은 Query RCU 를 줄이지 않으므로 캐시가 핵심.
- **get_comments**: Comments 에 `byPageId` GSI(PK `pageId`, 정렬키 없음 — 레거시 이관 댓글의 createdAt 이 숫자라 문자열 정렬키면 인덱스에서 빠진다)를 추가했다. 모든 항목에 pageId 가 있어 온라인 백필로 채워지고 스키마 변경은 없다. 백필 중·미배포 환경은 `ValidationException` 시 워크스페이스 GSI 스캔으로 폴백. 다른 워크스페이스 항목은 버린다.
- **search 본문**: 후보 100건(최근 수정순), BatchGet 프로젝션(`id, doc, dbCells, fullPageDatabaseId`) 20건 묶음, 누적 4MB 에 닿으면 중단(`bodyReadCapped`).

## P4 후속

- **WAF rate-based rule**: CloudFront 용 WebACL 은 us-east-1 에만 만들 수 있다 — `cdk bootstrap aws://<account>/us-east-1` 후 us-east-1 스택에서 WebACL(rate-based)을 만들어 배포에 연결.
- **searchText 인덱스 보류**: 본문 검색용 평문 필드를 페이지에 비정규화하려면 메타 GSI(`byWorkspaceMetaUpdatedAt`, INCLUDE 프로젝션)에 속성을 추가해야 하는데 INCLUDE 속성은 변경할 수 없어 GSI 재생성(삭제→생성, 한 배포 한 GSI·백필 동안 메타 조회 불가)이 필요하다. 클라 업서트 경로에서 searchText 를 채우는 작업도 함께 필요해 별도 단계로 미룬다.

## 테스트

서버 OAuth: `infra/lambda/mcp-server/__tests__/oauth.test.ts` — 메타데이터·DCR 검증·authorize 파라미터·쿠키 바인딩·CSRF·PKCE·코드 단일 사용·refresh 회전/재사용 감지·qn_oat_ 의 scope/워크스페이스 인가·`/revoke`·설정 탭 family 폐기.

`src/components/settings/__tests__/McpAdminAndPolicy.test.tsx` — 관리자 섹션 노출·강제/일괄 폐기·관리자 폐기 표시·정책 선택·발급 폼 정책 반영.
`src/components/settings/__tests__/McpSettingsTab.test.tsx` — 목록 렌더, 발급 시 원문 1회 표시·닫으면 제거, 읽기+쓰기 경고·write scope 발급, 폐기 mutation 호출, URL 미설정 자리표시자.
서버: `infra/lambda/mcp-server/__tests__/{updatePage,pageOps,collabWriter,concurrency,guards,queryDatabase,dbWrite,publish,edgeAndCost,adminPolicy,handler.e2e}.test.ts`, CloudFront: `infra/lib/mcp-edge-construct.test.ts`(엣지 함수 코드 직접 실행·배포 설정).
