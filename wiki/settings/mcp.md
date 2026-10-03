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

## 보안 규칙 (회귀 금지)

- **원문은 발급 직후 한 번만** 보여 준다. 패널 "닫기" 시 컴포넌트 상태에서 원문을 지우며, 목록 상태에는 원문을 넣지 않는다(`{ token, ...meta }` 분리).
- 서버는 SHA-256 **해시만 저장**하고 어떤 조회 응답에도 원문·해시를 싣지 않는다. 식별은 `tokenHint`(마지막 4글자, `…abcd`)로만.
- 원문을 store·localStorage·로그에 남기지 않는다.

## MCP 서버 URL

- CDK output `McpServerUrl`(Function URL + `mcp` 경로) 값을 `VITE_MCP_SERVER_URL` 로 주입한다(`.env.example` 참고).
- 미설정 빌드에서는 스니펫에 `<MCP 서버 URL>` 자리표시자와 안내 문구를 표시한다(UI 는 정상 동작).

## 쓰기 툴 (P2, `infra/lambda/mcp-server/serverWrite.ts`)

| 툴 | 입력 | 동작 |
|------|------|------|
| `create_pages` | `parent: {pageId}\|{databaseId}\|{workspaceId}`, `pages[1..20]: {title?, icon?, content?(QFM), properties?}` | 형제 끝에 생성. 일반 페이지 제목 중복은 `(1)`… 부여. DB 행 `properties` 는 사람 값 → 셀 변환(`cellInput.ts`) |
| `update_page` | `pageId, title?, icon?(null=제거), properties?, content?: {mode, markdown, anchor?, rangeStart?, rangeEnd?, occurrence?}` | mode = `replace`·`append`·`insert_after`(최상위 블록 텍스트 일치)·`replace_range`(텍스트 접두) |
| `move_pages` | `pageIds[1..20], newParent: {pageId}\|{workspaceId}` | 같은 워크스페이스만, 순환·DB 행 거부 |
| `duplicate_page` | `pageId, includeChildren?: false` | 앱과 같게 자신만 복제, `"{title} (Copy)"`, 원본 다음 순서 |
| `trash_page` | `pageId` | 자손 포함 soft delete(휴지통 30일). **영구삭제 툴 없음** |
| `create_comment` | `pageId, text, blockId?` | 기본은 첫 블록. v5 `upsertComment` 경로 |

### 쓰기 안전 규칙 (회귀 금지)

- **인가**: 토큰 `write` scope ∩ 토큰 `workspaceIds` ∩ 멤버 **edit** 권한 ∩ 타인 개인 WS 차단(`writeAccess.ts`). 스케줄러 가상 WS 쓰기 금지. read 토큰은 `token lacks write scope` 툴 오류.
- **본문은 Yjs 룸 경로만**(`collabWriter.ts`): 룸 로드 → update(append) → 룸 연결 브로드캐스트 → 병합 상태를 `upsertPage` 로 materialize(+`publishPageChanged`). `Pages.doc` 직접 기록은 열린 클라가 덮어쓴다.
  - 빈 룸: 서버 `Pages.doc` 을 `seedDocJson`(결정적 시드), placeholder/신규면 `allowEmptyRoom`.
  - 룸이 빈 문단뿐인데 `Pages.doc` 에 본문 → `Pages.doc` 기준 전체 교체로 룸 복구(삽입만 하면 기존 본문이 가려짐).
  - 결과 본문 350KB 초과·본문 전체 비우기(placeholder 가드가 옛 본문을 되살려 룸과 어긋남)는 룸에 쓰기 전에 거부. QFM 입력 512KB 초과는 `INPUT_TOO_LARGE`.
- **QFM 규약**(Plan §10.1): replace 는 현재 본문 `collectBlockRefs` 로만 해석, replace_range 는 교체 구간 블록만, append/insert_after 는 기존 `qn-block` 참조 불가. 결과 문서의 `<database id>` 중복 거부, 새 database 블록은 같은 WS 의 살아 있는 DB 만.
- **epoch 가드**(`epochGuard.ts`): rt-ydoc-updates·rt-ydoc(TTL 없음 — 옛 세대 룸 영구 잔존)·rt-connections(TTL, 활성 신호)를 Limit 100·키 projection 으로 Scan(컨테이너 캐시 10분). 거부(`EPOCH_MISMATCH`): (a) 관측 최대 epoch 이 서버 epoch 보다 큼(클라만 bump), (b) 활성 연결이 있는데 서버 epoch 연결이 없음. 그 외·빈 표본은 허용, 조회 실패는 거부. "서버 epoch 이 관측되는가" 판정은 옛 룸 잔재로 통과하므로 쓰지 않는다. 대상: update_page content/properties, DB 행 create, duplicate. 메타(제목·아이콘·move·trash·comment)·읽기는 대상 아님.
- **일일 쓰기 상한**: 토큰별 UTC 하루 **쓰는 페이지 수** 500(env `MCP_DAILY_WRITE_LIMIT`; create_pages 는 N, 나머지 툴은 1). ai-usage 원자 카운터 `pk=mcp-wd#<tokenId>#<YYYY-MM-DD>`, TTL 2일. 초과 시 다음 UTC 자정을 담은 툴 오류. read 토큰 호출은 카운트하지 않는다.
- **히스토리**: `replace`·`replace_range` 는 쓰기 전에 현재 협업 본문으로 `page.checkpoint` 버전을 강제 기록(`recordPageHistory force`).
- **DB 행 셀**: DB 룸(`db:<epoch>:<dbId>`)이 시드돼 있으면 `rows` 맵에도 기록(클라 `writeCellsToCollabDoc` 와 같은 구조) 후 `Pages.dbCells` 저장. 빈 룸이면 `Pages.dbCells` 만(첫 진입 `dbSeed` 가 시드). 신규 행은 같은 트랜잭션에서 `rowPageOrder` 끝·`rowMembers`(비어 있지 않을 때만 — 빈 멤버에 새 행만 넣으면 기존 행이 전부 숨는다)에 중복 없이 추가.
- **부분 갱신**: 기존 페이지 저장은 저장 직전 최신 항목을 다시 읽어 툴이 바꾼 필드만 덮고(`patchPage`), `upsertPage(expectedUpdatedAt)` 로 updatedAt 조건부 Put — 충돌 시 1회 재시도 후 오류. 셀은 최신 dbCells 에 병합.
- **입력 형식**: 신규 본문(create·duplicate)도 350KB 상한을 쓰기 전에 전부 검사. `icon` 은 이모지·`quicknote-lucide:<Name>:<hex>`·`quicknote-image://<id>` 만(임의 URL 거부). person 셀은 대상 워크스페이스 접근 멤버만이며 없음·권한 없음은 같은 오류.
- **미지원(P3)**: DB 행 이동·복제·휴지통, 풀페이지 DB 홈 본문·제목 수정. 휴지통 이동은 `PageInput` 에 `deletedAt` 이 없어 실시간 발행 불가 → 열린 클라는 다음 델타 동기화에서 반영. MCP 댓글도 실시간 구독 발행 경로가 없다.
- **감사**: 툴마다 `{evt:"mcp.tool", tool, tokenId, memberId, ids(pageIds·mode·bytes), ms, ok}` 한 줄. 페이지에는 `lastEditedBy*`(토큰 소유 멤버)·`lastEditSource:"mcp"`.

### WS 브로드캐스트 배선 (스택 간)

RealtimeCollabStack 이 SyncStack 을 이미 참조하므로 역참조는 순환이다 → 명명 규칙(`infra/lib/mcp-collab-wiring.ts`).
- SyncStack: `McpServerFn` 역할 이름 고정(`{envPrefix}quicknote-mcp-server`), rt-* 테이블 권한은 이름 규칙 ARN, env `COLLAB_WS_ENDPOINT_PARAM`.
- RealtimeCollabStack: SSM `/{envPrefix}quicknote/collab-ws-management-endpoint`(= `stage.callbackUrl`) 게시 + 그 역할에 `execute-api:ManageConnections`(해당 API/stage)·`ssm:GetParameter` 정책 부착.
- 배포 순서: **Sync → Realtime**(역할을 Sync 가 만들고 Realtime 이 `Role.fromRoleName` 으로 정책을 붙인다). `fromRoleName` 은 CFN 의존이 없어 역할 이름 변경·Realtime 단독 배포 시 결합이 조용히 끊길 수 있다 — `infra/deploy.md` STEP 3 참고. 엔드포인트를 못 읽으면 브로드캐스트만 생략(룸에는 저장 — 열린 클라는 재연결 hello 때 받음).

## 테스트

`src/components/settings/__tests__/McpSettingsTab.test.tsx` — 목록 렌더, 발급 시 원문 1회 표시·닫으면 제거, 읽기+쓰기 경고·write scope 발급, 폐기 mutation 호출, URL 미설정 자리표시자.
서버: `infra/lambda/mcp-server/__tests__/{updatePage,pageOps,collabWriter,handler.e2e}.test.ts`.
