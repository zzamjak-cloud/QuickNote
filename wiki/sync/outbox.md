# IndexedDB Outbox

## 파일
`src/lib/sync/engine.ts`

## 역할
로컬 액션을 즉시 IndexedDB outbox 에 적재하고, AppSync GraphQL 뮤테이션으로 전송.
전송 실패 시 지수 백오프(1s→2s→...→60s)로 재시도.
전송 성공 시 outbox 항목 제거.

## 디버깅: outbox 확인
```
브라우저 DevTools → Application → IndexedDB → (앱명) → outbox 테이블
```
entries 가 있으면 → 뮤테이션이 서버에 전달되지 않은 것 (CDK 미배포 또는 네트워크 문제)

## outbox 가 쌓이는 원인
1. CDK 미배포 → AppSync 스키마 불일치
2. 인터넷 오프라인
3. AppSync API Key 만료

## OutboxAdapter.count() — soft 상한 감지

`OutboxAdapter` 인터페이스에 optional `count?(): Promise<number>` 메서드가 있다.
엔진은 `enqueueNow` → `upsertByDedupe` 직후 `maybeWarnOutboxBacklog()`를 호출해 대기 entry 수를 점검한다(throttle 60s).

| 어댑터 | 구현 방식 |
|--------|-----------|
| `adapter.web.ts` | Dexie `db.entries.count()` |
| `adapter.tauri.ts` | `SELECT COUNT(*) AS c FROM outbox_entries` |
| `adapter.memory.ts` | `byId.size` |

`count()`가 없는 어댑터는 `list(OUTBOX_SOFT_CAP + 1).length`로 폴백한다.

**soft 상한 초과 시 동작**: `console.warn` + `useUiStore.showToast` 에러 토스트.
**entry는 절대 버리지 않음** — soft 상한은 비정상 누적(stuck flush / 폭주 enqueue)을 알리는 관측 신호이고 데이터 유실은 0.
진단 실패(예외)는 try/catch로 삼켜 enqueue 데이터 경로에 영향을 주지 않는다.

## upsertPage input 구성 (단일 매퍼)

`upsertPage` outbox payload(GraphQL input)는 손작성하지 않고 **`toUpsertPageInput()`** 단일 매퍼로 구성한다.

- 위치: `src/lib/sync/mappers/upsertPageInput.ts:30`
- 호출처: `src/store/pageStore/helpers.ts`(`toGqlPage` 경로), `src/store/databaseStore/helpers.ts`(`enqueueUpsertPageRaw` 경로). 이전에는 두 곳이 input 객체를 각자 손으로 만들어 필드 누락(PageMeta 소실류) 회귀 위험이 있었다(Phase 4.3 단일화, behavior-preserving).
- 매퍼가 집약하는 경계 변환: `order` number→`String`, `doc`/`dbCells` 객체→`JSON.stringify`, `createdAt`/`updatedAt` epoch ms→ISO 문자열.
- 호출처별 차이는 매퍼가 결정하지 않고 `opts`(`ToUpsertPageInputOpts`)로 받아 그대로 싣는다: 해석된 `workspaceId`/`databaseId`(스케줄러 ID 정규화 등), 최종 `dbCells`(협업 제어 반영), `includeMetaColors`(titleColor/coverImage — toGqlPage 경로 전용), `includeFullPageDatabaseId`.

> **회귀 가드**
> - **AWSJSON 객체→문자열**: AppSync AWSJSON 스칼라는 JSON 문자열을 요구한다. `doc`/`dbCells` 를 객체로 보내면 `Variable has an invalid value` 검증 오류로 mutation 이 거부된다 → 매퍼가 항상 `JSON.stringify`. (서버측 동일 경계 방어는 아래 참조)
> - **`fullPageDatabaseId` 값 있을 때만 적재**: 키 부재 시 서버가 기존 태그를 보존하므로, 태그가 로컬에 없는(stale) 페이지의 재업서트가 서버 태그를 소거하지 못한다.
> - **350KB payload 가드 미변경**: `MAX_UPSERT_PAGE_PAYLOAD_BYTES` 가드는 이 리팩토링에서 손대지 않았다. 큰 본문은 여전히 가드에 걸리며, 사이드바 이동은 meta-only upsert 를 사용한다([subscribers.md](subscribers.md) 참조).

## 서버측 AWSJSON 경계 방어 (2026-06-16 라이브 hotfix)

클라이언트 매퍼가 정상이면 doc/dbCells 는 문자열로 도착하지만, 구버전/비정상 클라이언트가 객체로 보내면 DynamoDB 의 32레벨 중첩 한도를 초과해 `Nesting Levels have exceeded the supported limit` 로 신규 페이지 생성이 거부됐다.

방지: `infra/lambda/v5-resolvers/handlers/pageDatabase.ts` 의 `upsertPage` 가 저장 직전 `doc`/`dbCells`/`blockComments` 가 문자열이 아니면 `JSON.stringify` 로 정규화한다(이미 문자열이면 그대로 — idempotent, 정상 클라이언트 무영향). 회귀 테스트: `infra/lambda/v5-resolvers/handlers/pageDatabase.test.ts`. 클라이언트·서버 양쪽이 같은 경계를 지키는 이중 방어다.
