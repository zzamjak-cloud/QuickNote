# subscribers.ts

## 역할
AppSync WebSocket 구독을 시작·관리하고, 인증 오류·네트워크 단절 시 지수 백오프로 자동 재연결하는 모듈.

## 위치
`src/lib/sync/subscribers.ts`

## 주요 exports
| 이름 | 종류 | 설명 |
|------|------|------|
| `SubscribeHandlers` | type | 구독 이벤트 핸들러 맵 |
| `startSubscriptions` | function | 지정 워크스페이스에 대한 전체 구독 시작, cleanup 함수 반환 |

## 주요 상수
| 상수 | 값 | 설명 |
|------|----|------|
| `MAX_RETRY_DELAY_MS` | 30,000 | 재연결 최대 대기(ms) |
| `MAX_RETRY_ATTEMPTS` | 12 | 재연결 최대 시도 횟수 |
| `SUB_ERROR_LOG_THROTTLE_MS` | 10,000 | 구독 오류 로그 throttle |

## SubscribeHandlers 타입
| 필드 | 필수 | 설명 |
|------|------|------|
| `onPage` | 필수 | 페이지 변경 수신 |
| `onDatabase` | 필수 | DB 변경 수신 |
| `onComment` | 필수 | 댓글 변경 수신 |
| `onProject` | 선택 | 프로젝트 변경 수신 |
| `onWorkspace` | 선택 | 워크스페이스 접근권한 변경 신호 수신 |

## 동작 흐름
1. `startSubscriptions(workspaceId, handlers)` 호출
2. `ensureFreshTokensForAppSync()`로 idToken 획득
3. `appsyncClient().graphql()`으로 각 채널 구독 시작:
   - `ON_PAGE_CHANGED` → `handlers.onPage`
   - `ON_DATABASE_CHANGED` → `handlers.onDatabase`
   - `ON_COMMENT_CHANGED` → `handlers.onComment`
   - `ON_PROJECT_CHANGED` → `handlers.onProject` (핸들러 있을 때만)
   - `ON_WORKSPACE_CHANGED` → `handlers.onWorkspace` (핸들러 있을 때만)
4. 구독 연결 완료 후 `getSyncEngine().scheduleFlush(0)` — 오프라인 중 쌓인 outbox 즉시 flush
5. 오류 발생 시:
   - 인증 오류 → `ensureFreshTokensForAppSync()` 후 재시도
   - 기타 오류 → 지수 백오프(`min(2^attempts * 1000, MAX_RETRY_DELAY_MS)`) 후 `connect()` 재호출
6. `window 'online'` 이벤트 → 재연결 타이머 초기화 + 즉시 `connect()` + `scheduleFlush(0)`
7. cleanup 함수 호출 시 구독 전체 해제 + `online` 리스너 제거

## 외부 의존
- `appsyncClient` (`src/lib/sync/graphql/client`)
- GraphQL 구독 쿼리: `ON_PAGE_CHANGED`, `ON_DATABASE_CHANGED`, `ON_PROJECT_CHANGED`, `ON_COMMENT_CHANGED`, `ON_WORKSPACE_CHANGED`
- `ensureFreshTokensForAppSync` (`src/lib/auth/apiTokens`)
- `getSyncEngine` (`src/lib/sync/runtime`)
- Zod 스키마: `GqlPageSchema`, `GqlDatabaseSchema`, `GqlCommentSchema`, `GqlProjectSchema`

## 구독 수명주기 (호출측 — `Bootstrap.tsx`)
구독을 **언제 열고 닫는지** 는 호출측이 결정한다(비용 직결). 회귀 주의:
- **LC 스케줄러 구독은 스케줄러 팝업이 열려 있을 때만 유지**한다(`useSchedulerViewStore.schedulerOpen` 게이트). 공용 워크스페이스라 상시 구독하면 미사용 세션에서도 WebSocket 연결 시간이 과금된다. 닫혀 있는 동안의 변경분은 모달 진입 시 `fetchSchedules`·`refreshWorkspaceMeta`(증분)로 보정. → 상시 구독으로 되돌리지 말 것.
- **커스텀 아이콘 구독은 페이로드를 직접 반영**한다 — 이벤트마다 `listCustomIcons` 전체 재페치 금지. `onCustomIconChanged` 페이로드의 `deletedAt` tombstone 으로 추가/삭제를 구분해 `useCustomIconStore.applyServerEvent(icon, !!icon.deletedAt)` 호출. (서버 `deleteCustomIcon` 이 `deletedAt` 을 채워 반환)
- `onWorkspace` 는 권한 변경 신호(희소)라 수신 시 `listMyWorkspacesApi` 재페치 유지(정상).

## 주의사항
- AppSync USER_POOL 인증에서 subscription 핸드셰이크는 `authToken` 옵션으로 직접 토큰 주입 필요 (Amplify `headers` 함수 불가)
- 각 채널(page/database/comment/project/workspace)을 독립 try-catch로 시작 — 하나 실패해도 나머지 구독 유지
- `retryAttempts`는 성공(`next`) 수신 시 0으로 초기화
- `MAX_RETRY_ATTEMPTS` 초과 시 재연결 중단 (온라인 이벤트로만 복구 가능)
- 수신된 데이터는 `parseGqlOne` + Zod 스키마로 검증 후 핸들러 호출
