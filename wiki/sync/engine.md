# engine.ts

## 역할
로컬 액션을 IndexedDB outbox에 적재하고 백그라운드에서 AppSync GraphQL mutation으로 flush하는 동기화 엔진 클래스.

## 위치
`src/lib/sync/engine.ts`

## 주요 exports
| 이름 | 종류 | 설명 |
|------|------|------|
| `GqlBridge` | interface | AppSync mutation 어댑터 인터페이스 (upsertPage, softDeletePage 등) |
| `SyncEngine` (클래스) | class | outbox 관리 + flush 루프 + 재시도 로직 전체 |

## 주요 상수
| 상수 | 값 | 설명 |
|------|----|------|
| `MAX_BACKOFF_MS` | 60,000 | 백오프 최대 대기(ms) |
| `MAX_ATTEMPTS` | 15 | 영구 실패 판정 시도 횟수 상한 |
| `AUTH_RETRY_DELAY_MS` | 5,000 | 인증 오류 후 재시도 대기 |
| `TRANSIENT_RETRY_DELAY_MS` | 4,000 | 네트워크 일시 오류 재시도 대기 |
| `TRANSIENT_LOG_THROTTLE_MS` | 15,000 | 반복 네트워크 오류 로그 throttle |
| `DEAD_LETTER_TTL_MS` | 30일 | 영구 실패 항목 자동 만료 TTL |

## 주요 메서드
| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|---------|--------|------|
| `enqueuePayload` | op, payload | `Promise<void>` | outbox에 항목 추가 (dedupe key로 중복 압축) |
| `flush` | — | `Promise<void>` | outbox 배치를 순서대로 mutation 전송 |
| `scheduleFlush` | `delayMs` | `void` | 지정 지연 후 flush 예약 |
| `getPendingUpsertEntityIds` | — | `Promise<{pages, databases}>` | 아직 전송 중인 엔티티 id 집합 반환 |
| `purgePendingForPageIds` | `ids` | `Promise<void>` | 특정 페이지 id 의 outbox 항목 전부 제거 |
| `clearAll` | — | `Promise<void>` | outbox 전체 삭제 |
| `listDeadLetters` | — | `Promise<OutboxEntry[]>` | 영구 실패 항목 목록 조회 |
| `stop` | — | `void` | 엔진 중지 (타이머·루프 정리) |

## 동작 흐름
1. 로컬 액션 발생 → `enqueuePayload(op, payload)` 호출 → IndexedDB outbox에 적재
2. `scheduleFlush(0)` 또는 타이머로 `flush()` 진입
3. outbox에서 최대 20개 배치 조회 → `sortOutboxBatchForFlush`로 정렬 (워크스페이스 우선)
4. 동일 (op, id) 의 중복 upsert는 dedupe key로 마지막 버전만 전송 (`supersededUpsertDedupeKeysForDeleteBatch`)
5. 각 항목에 대해 `execute(entry)` → GqlBridge mutation 호출
6. 성공 시 outbox에서 제거, 실패 분기:
   - **인증 오류**: `ensureFreshTokensForAppSync()` 후 `AUTH_RETRY_DELAY_MS` 백오프
   - **네트워크 일시 오류**: `TRANSIENT_RETRY_DELAY_MS` 백오프
   - **payload 초과**: dead letter로 이동 후 제거
   - **resource-gone (삭제 대상이 이미 없음)**: dead letter 승격 + `promoteDeleteEntryToPermanentTombstone` 호출
   - **`MAX_ATTEMPTS` 초과**: stuck-head 방지를 위해 outbox에서 제거
7. 실패 항목이 있으면 `minFailBackoff` 딜레이 후 루프 재진입

## 외부 의존
- `OutboxAdapter` (IndexedDB 어댑터, `src/lib/sync/outbox/`)
- `GqlBridge` 구현체 (AppSync GraphQL client)
- `ensureFreshTokensForAppSync` (`src/lib/auth/apiTokens`)
- `markPermanentlyDeletedEntity` (`src/lib/sync/localDeleteGuards`)
- `sortOutboxBatchForFlush` (`src/lib/sync/outboxFlushOrder`)
- `useUiStore` (워크스페이스 로그 목적)

## 주의사항
- `MAX_ATTEMPTS`를 초과한 항목은 silent drop됨 — stuck-head(후속 항목 처리 차단) 방지가 목적
- `clientPrefsJson` v2 포맷은 서버로 보내기 전 v1으로 정규화 (`normalizeClientPrefsJsonForServer`)
- `purgePendingForPageIds`는 휴지통 영구삭제 직후 반드시 호출해야 함. 미호출 시 upsert가 flush되어 서버에 페이지가 재생성(되살아남)됨
- dead letter TTL이 만료된 항목은 `flush()` 진입 시 `pruneExpiredDeadLetters`로 자동 정리
