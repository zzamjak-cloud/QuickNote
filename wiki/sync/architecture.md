# 동기화 아키텍처

## 소스 오브 트루스
```
AppSync (원격)  ←  진실의 원천
localStorage    ←  빠른 첫 렌더용 캐시 (원격 스냅샷)
```

## 워크스페이스 초기 로드 전략 (분할 로드)

워크스페이스가 커져도 쾌적하게 동작하도록 **메타 먼저, 본문·행은 필요 시** 방식으로 전환됐다.

```
1단계: 메타 스냅샷 로드 (항상)
  fetchApplyWorkspaceRemoteMetaSnapshot()
  ├─ listPageMetas (제목·아이콘·parentId·fullPageDatabaseId 등 메타만, doc 제외)
  │   └─ GSI: byWorkspaceAndUpdatedAt (ALL 프로젝션) — 페이지 수 무제한
  │       nextToken 자동 루프 → 100개 초과 워크스페이스도 전부 로드
  │       DB row가 앞에 몰린 워크스페이스(CAT 등)는 resolver가 필터 후 메타 limit를 채운다
  ├─ listDatabases
  └─ listComments
  → 사이드바·트리 즉시 렌더 가능

2단계: 페이지 본문 지연 로드 (열 때)
  ensurePageContentLoaded(pageId)
  ├─ metaOnlyByPageId[pageId] 확인
  ├─ fetchPageById(workspaceId, pageId)
  └─ applyRemotePageToStore() + refreshWorkspaceSnapshot()

3단계: 외부 보호 DB 행 배치 로드 (DB 접근 시)
  ensureExternalProtectedDatabaseLoaded(databaseId)
  ├─ fetchDatabaseById() + fetchDatabaseRowsBatch() 병렬
  ├─ nextToken 저장 → loadMoreExternalProtectedDatabaseRows() (페이지네이션)
  └─ schema 미지원 서버 → legacy 전체 스냅샷 fallback
```

**예외(전체 스냅샷 경로):**
- `no-cache` 상태이면서 `listPageMetas` API가 응답 후 캐시가 여전히 비어 있는 경우 → `fetchApplyWorkspaceRemoteSnapshot`(전체) fallback 자동 실행
- LC 스케줄러 워크스페이스에서 `마일스톤 DB`, `피처 DB`, `작업 DB` 루트 페이지가 빠진 캐시가 감지되면 → page meta token/watermark 를 초기화하고 `forceMetaBaseline` 으로 재조회

### CAT 워크스페이스 사이드바 페이지 결손 회귀

CAT(공용아트팀)처럼 DB row 페이지가 많은 워크스페이스에서는 개발 빌드 진입 후 사이드바 페이지가 대부분 사라져 보일 수 있다.

원인은 `listPageMetas`가 DynamoDB Query의 `Limit`을 먼저 적용한 뒤 DB row(`databaseId` 존재)를 필터링한 것이다. 최신순 앞쪽에 DB row가 몰려 있으면 첫 배치 대부분이 필터링되고, 클라이언트는 적은 메타만 받은 상태에서 page meta baseline 을 완료한 것으로 판단한다. 이후 watermark 가 전진하면 누락된 오래된 일반 페이지는 delta 로 다시 내려오지 않는다.

방지 규칙:
- `infra/lambda/v5-resolvers/handlers/pageDatabase.ts`의 `listPageMetas`는 DB row 필터링 후 일반 페이지 메타가 `limit`만큼 찰 때까지 내부 페이지네이션을 계속해야 한다.
- `src/lib/sync/bootstrap.ts`의 `PAGE_META_LIMIT`은 큰 워크스페이스 초기 사이드바 기준선을 담을 수 있을 만큼 유지한다.
- 이 문제가 배포된 적이 있으면 `src/Bootstrap.tsx`의 `WORKSPACE_CACHE_REPAIR_REVISION`을 올려 `pageMetaRemote`/`syncWatermark`를 초기화하고 `forceMetaBaseline`을 다시 실행시킨다.

**근본 가드 (콜드 부팅 메타 재조정, 워크스페이스 무관):**
이미 watermark 가 전진한 stale/부분 캐시는 위 서버 수정 이후에도 delta 로는 누락 페이지를 못 받는다. 그래서 `src/Bootstrap.tsx` 는 **앱 콜드 부팅(첫 워크스페이스 로드, `isInitialWorkspaceBootstrap` 이고 `fetchMode.kind === "delta"`)에서 무조건 `forceMetaBaseline` 1회**를 수행한다. 메타 baseline 은 prune 없이 전체 페이지 메타를 머지하므로 누락 루트 페이지를 자가 치유하고, 본문이 없어 가볍다. 세션 중 워크스페이스 전환(`prev!==null`)은 그대로 delta 로 유지한다. LC 전용 `lcSchedulerWorkspaceRepair` 와 달리 이 가드는 모든 워크스페이스(CAT 포함)에 적용된다.

회귀 체크:
- DB row가 많은 워크스페이스에서 첫 진입 직후 사이드바 일반 페이지 수가 줄지 않아야 한다.
- `listPageMetas` 응답이 DB row를 제외한 일반 페이지 메타 기준으로 limit를 채워야 한다.
- dev/live origin 별 IndexedDB 캐시가 분리되어 있으므로, 한쪽에서만 재현되면 해당 origin의 page meta baseline/watermark 상태를 먼저 확인한다.

관련 구현: `pageDatabase.ts`의 `listPageMetas`, `bootstrap.ts`의 `fetchPageMetasByWorkspace`, `Bootstrap.tsx`의 one-time workspace cache repair.

### 쿼리 필드 ↔ 스키마 타입 정합성 (2026-06-11 라이브 사고)

클라이언트 `PAGE_META_FIELDS`(`src/lib/sync/queries/page.ts`)에 `lastEditedByMemberId`/`lastEditedByName`이 추가됐지만 `infra/lib/sync/schema.graphql`의 `PageMeta` 타입에는 누락(`Page` 타입에만 추가)되어, AppSync가 모든 `listPageMetas` 요청을 FieldUndefined 검증 에러로 거절했다. 클라이언트의 `isPageMetaSchemaUnavailable`이 이를 "API 미배포"로 분류해 조용히 스킵 → 콜드 로드 사이드바가 빈 화면이 됐고, 캐시 보유 브라우저만 정상처럼 보여 환경별로 증상이 갈렸다.

방지 규칙:
- Page 계열 쿼리에 필드를 추가할 때는 `schema.graphql`의 `Page` + `PageMeta` 양쪽, 그리고 `listPageMetas`의 `ProjectionExpression`(`pageDatabase.ts`)까지 3곳을 동시에 수정한다.
- `src/lib/sync/queries/__tests__/schemaFieldParity.test.ts`가 LIST_PAGES/LIST_PAGE_METAS 요청 필드 ⊆ 스키마 타입 필드를 강제한다. 새 쿼리를 추가하면 이 테스트에도 등록한다.
- 스키마 거부로 메타가 0건일 때는 워터마크를 전진시키지 않는다(`workspaceSnapshotBootstrap.ts`). 이미 전진된 캐시는 `WORKSPACE_CACHE_REPAIR_REVISION` bump 로 재기준선한다.

진단 팁: 이 증상은 리졸버 Lambda 로그에 아무것도 남지 않는다(검증 단계 거절). AppSync 로그 그룹(`/aws/appsync/apis/<apiId>`)에서 `GraphQLFieldValidationError`를 검색하는 것이 가장 빠르다.

### LC 스케줄러 루트 DB 페이지 결손 복구

개발/라이브 origin 별 IndexedDB 캐시가 갈라진 상태에서 LC 보호 DB 정의와 row cache 는 남아 있는데
사이드바 루트 페이지(`마일스톤 DB`, `피처 DB`, `작업 DB`)만 빠질 수 있다. 이 상태에서 watermark 가
해당 루트 페이지의 `updatedAt` 보다 최신이면 delta 모드는 오래된 루트 페이지를 다시 받지 못한다.

복구 경로:
1. `src/lib/sync/lcSchedulerWorkspaceRepair.ts` 가 LC 워크스페이스 루트 페이지 3개 존재 여부를 검사한다.
   - meta-only 페이지는 제목으로 인정한다.
   - 사용자가 제목을 바꾼 경우 첫 `databaseBlock` 의 protected DB id 로도 인정한다.
2. `src/Bootstrap.tsx` 는 결손 감지 시 `databaseRowRemote`, `pageContentLoad`, `pageMetaRemote`, `syncWatermark` 를 초기화한다.
3. 이어서 `fetchApply({ forceMetaBaseline: true })` 로 서버 메타를 baseline 재조회한다.
4. `createLCSchedulerRootPageRepairGate()` 는 같은 앱 실행 세션에서 동일 워크스페이스 repair 를 1회만 허용한다. 루트 페이지가 복구되면 gate 는 다시 열린다.

상세 판정 기준과 회귀 체크는 [lc-scheduler-workspace-repair.md](lc-scheduler-workspace-repair.md)를 참조한다.

## Ghost 페이지 방지 (풀페이지 DB 홈 페이지)

풀페이지 DB를 생성하면 홈 페이지가 사이드바에 중복 표시(`ghost`)될 수 있다.

**방지 체계:**
- `upsertPage` 시 `fullPageDatabaseId` 필드를 함께 저장 (클라이언트 → 서버 → DynamoDB)
- `listPageMetas` 응답에 `fullPageDatabaseId` 포함 → 동기화 시 클라이언트 수신
- `isHiddenInSidebar` selector: `fullPageDatabaseId` 있으면 `true` → 사이드바 필터링

**레거시 backfill:** 기존 생성 항목(dev 22건, live 24건)은 일괄 `fullPageDatabaseId` 설정 완료.

관련: [ghost-page-prevention.md](../pages/ghost-page-prevention.md)

## fetchMode 결정 (delta vs full)

`resolveWorkspaceRemoteFetchMode()` → `WorkspaceRemoteFetchMode` 반환

| 조건 | 모드 | reason |
|------|------|--------|
| 캐시 없음 | full | `no-cache` |
| watermark 없음 | full | `no-watermark` |
| switchResult.cleared | full | `cache-cleared` |
| reason: deferred-switch / pending-outbox / initial-cache-mismatch / switched | full | 해당 reason |
| 위 조건 모두 미해당 | **delta** | `cache-watermark` |

delta 모드는 `updatedAfter = watermark` 이후 변경분만 페치하며 **절대 prune 하지 않는다**.

## 흐름

### 로컬 액션 → 원격
```
로컬 액션 (createPage 등)
  → Zustand 스토어 업데이트 (즉시 UI 반영)
  → IndexedDB outbox 적재 (src/lib/sync/engine.ts)
  → AppSync GraphQL 뮤테이션 전송
  → 성공: outbox 에서 제거
  → 실패: 지수 백오프 재시도 (1s → 2s → ... → 60s)
```

### 원격 변경 수신
```
AppSync 구독 (WebSocket)
  → LWW 충돌 해결 (src/lib/sync/storeApply.ts)
  → Zustand 스토어 업데이트
```

회귀 체크: 데스크톱 앱은 Amplify Auth 세션이 아니라 `oidc-client-ts` 토큰 저장소를 사용한다. AppSync subscription 은 `authToken` 옵션이 WebSocket 핸드셰이크 `Authorization` 으로 전달되지 않으므로, `authMode: "none"` + `additionalHeaders.Authorization` 경로를 유지해야 한다. 이 경로가 깨지면 쿼리/뮤테이션은 성공해도 삭제·이동·아이콘 같은 실시간 이벤트만 새로고침 전까지 반영되지 않는다.

### 네트워크 복구 시
```
window 'online' 이벤트
  → AppSync 핸드셰이크(경량 authed 호출) — 실패 시 backoff 재시도(최대 5회)
    (navigator.onLine=true 라도 캡티브 등 거짓 online 대응; 성공해야 다음 단계 진행)
  → 오프라인 갭 기반 재페치 escalation (src/lib/sync/offlineGap.ts)
      gap < 10분  → delta(watermark)
      gap ≥ 10분  → meta-baseline(누락 항목 자가치유, prune 없음)
      gap ≥ 24h   → full(prune 포함)
  → AppSync 구독 재연결
  → outbox flush (오프라인 중 쌓인 mutations 전송)
```
갭 추적: `initOfflineGapTracking()`(main.tsx)가 offline 진입 시각을 sessionStorage 에 기록,
재접속 시 `consumeOfflineGapMs()` 로 소비. 적체 가시성은 `OfflineBadge`(TopBar) + `usePendingOutboxCount`.

### 캐시 비움 ↔ 워터마크 정합 (단일 진입점)
persist 데이터 캐시를 비울 때는 **반드시 워터마크도 함께 리셋**해야 한다. 어긋나면 delta 페치가
비워진 데이터를 건너뛰어 영구 유실된다(댓글 사라짐·유령페이지 회귀 근본 원인). 두 작업은
`resetWorkspaceLocalCaches(workspaceId)`(`src/lib/sync/resetWorkspaceLocalCaches.ts`) 단일
진입점으로 강제하고, 호출 후 `forceMetaBaseline` 페치로 데이터를 다시 채운다. 향후 store
persist 스키마 bump 복구 경로도 이 헬퍼를 거친다([store/schema-versioning.md](../store/schema-versioning.md)).

### PWA Service Worker 캐시 정책 (불변식)
SW(vite-plugin-pwa)는 **정적 셸·해시 청크만 precache** 한다. **API/Cognito/동적 데이터는 절대
가로채지 않는다**(`navigateFallbackDenylist`로 `/api/`·`/auth/` 제외) — SW 가 GraphQL 응답을
캐시하면 delta/watermark 정합이 깨지므로 영구 금지. 위험은 stale 셸(옛 번들→옛 청크/옛 epoch)
간접 경로뿐이며, `swController` 주기 업데이트 + `chunkReload` SW 강제 교체로 신선도를 상한한다.
협업 epoch 과의 배포 정합은 [collab-live-deploy-checklist §1.8](../infra/collab-live-deploy-checklist.md).

## 동기화 엔티티 추가 시 등록점 (단일화)

새 완전동기화 엔티티/op 추가는 **세 등록점**만 수정하면 된다. 분산 분기를 흩지 말 것.

1. `src/lib/sync/outbox/types.ts` — `OutboxOp` union + (신규 엔티티면) `OutboxEntityType`.
2. `src/lib/sync/syncOpRegistry.ts:58` — `SYNC_OP_REGISTRY[op]` 항목. `execute`/`isDelete`/`supersededUpsertOp`/`tombstoneEntity` 와 **메타 플래그 3종**(`workspaceScoped`/`capturesBaseVersion`/`warnIfMissingWorkspace`)을 채운다. `outboxMeta.ts`(`buildOutboxEntryMeta`) 와 `engine.ts` 의 실행/삭제 분기가 모두 이 항목으로 구동되므로 별도 switch 추가 금지. `GqlBridge` 인터페이스에 새 mutation 이 필요하면 여기서 함께 선언하고 `bridge.ts` 의 `realGqlBridge` 가 구현한다.
3. (서버 푸시를 받는 엔티티면) `src/lib/sync/subscribers.ts` 의 `channels` 디스크립터 배열에 `{key,query,enabled,onNext}` 1건 + `SubscribeHandlers` 핸들러. 5개 채널(page/database/comment/project/workspace)이 이전엔 복붙 try-catch 블록이었으나 Phase 3.2 에서 단일 디스크립터 루프로 통합됐다(behavior-preserving).

회귀 체크:
- op 추가 후 `outboxMeta.ts`/`syncOpRegistry.ts` 가 컴파일되면(`Record<OutboxOp, SyncOpSpec>` 이라 누락 op·누락 플래그는 타입 에러) 메타가 자동 채워진다.
- engine 의 `execute`/`isDeleteOp`/`supersededUpsertOpForDelete`/`tombstoneEntity` 조회는 레지스트리만 본다([engine.md](engine.md) 참조).
- `apply`(storeApply LWW)는 의도적으로 이 레지스트리에 넣지 않는다(거대 핫로직).

## GraphQL 읽기 호출 언랩 (gqlRequired/gqlOptional)

읽기측 `*Api.ts` 들이 `appsyncClient().graphql({query,variables})` 호출 후 `as { data?: { op?: ... } }` 캐스트 → `data?.op` 언랩 → 없으면 throw(필수)/null(선택) 하던 수동 패턴은 **`src/lib/sync/graphqlRequest.ts`** 의 두 헬퍼로 통일됐다(Phase 4.1, 9개 파일 23개 사이트, behavior-preserving).

- `gqlRequired<T>(query, variables, opName)` — `data[opName]` 이 null/undefined 면 `throw new Error("<opName> 응답 없음")`.
- `gqlOptional<T>(query, variables, opName)` — null/undefined 면 `null` 반환(호출자가 fallback 적용).
- **대상 아님**: GraphQL `errors` 배열을 검사하거나 응답을 무시(fire-and-forget)하는 사이트는 동작이 달라 그대로 둔다. 단순 op 언랩만 흡수한다.

## 스키마 정합성 자동 검사 (schemaFieldParity)

`src/lib/sync/queries/__tests__/schemaFieldParity.test.ts` 는 Phase 4.4 에서 2개 하드코딩 쿼리 검사 → **`items` 셀렉션을 가진 모든 list 쿼리**를 SDL 의 Query/Connection 타입 파싱으로 자동 해소해 "요청 필드 ⊆ 스키마 타입 필드" 정합성을 전수 검사한다(FieldUndefined 거절 사고 부류 광범위 예방). 추가로 Page 스칼라 타입↔SDL 정합을 고정하고, `order`(클라 number ↔ SDL String) 같은 의도된 표류는 allowlist 로 명시한다. 새 list 쿼리는 별도 등록 없이 자동 검사 대상이 된다.

## 핵심 파일

| 파일 | 역할 |
|------|------|
| `src/lib/sync/engine.ts` | IndexedDB outbox, 뮤테이션 전송, 재시도 |
| `src/lib/sync/syncOpRegistry.ts` | op→엔티티 배선(execute/delete/supersede/tombstone)·메타 플래그·`GqlBridge` 계약 단일 등록점 |
| `src/lib/sync/outboxMeta.ts` | `buildOutboxEntryMeta` — 레지스트리 메타 플래그로 outbox 행 메타 구성 |
| `src/lib/sync/graphqlRequest.ts` | 읽기 호출 언랩 헬퍼 `gqlRequired`/`gqlOptional` |
| `src/lib/sync/mappers/upsertPageInput.ts` | upsertPage GraphQL input 단일 매퍼 `toUpsertPageInput` |
| `src/lib/sync/subscribers.ts` | AppSync WebSocket 구독 재연결(단일 채널 디스크립터 루프) |
| `src/lib/sync/storeApply.ts` | 페이지/DB LWW 충돌 해결 |
| `src/lib/sync/storeApply/commentApply.ts` | 댓글 LWW 적용 reducer(storeApply 에서 분리) |
| `src/lib/sync/storeApply/helpers.ts` | `parseAwsJson`(envelope shape 검증 포함) 등 순수 헬퍼 |
| `src/lib/sync/schemas/index.ts` | `DocEnvelopeSchema`/`DbCellsSchema` 등 수신 검증 스키마 |
| `src/lib/sync/workspaceFetchMode.ts` | delta/full 모드 결정 로직 |
| `src/lib/sync/workspaceSnapshotBootstrap.ts` | 메타·전체 스냅샷 페치 및 적용 |
| `src/lib/sync/lcSchedulerWorkspaceRepair.ts` | LC 스케줄러 루트 DB 페이지 결손 감지 및 repair gate |
| `src/lib/sync/pageContentLoad.ts` | 페이지 본문 지연 로드 |
| `src/lib/sync/externalProtectedDatabaseLoad.ts` | 외부 보호 DB 행 배치·페이지네이션 로드 |
| `src/store/pageContentLoadStore.ts` | metaOnly 상태 추적 (persist) |
| `src/store/databaseRowRemoteStore.ts` | DB 행 nextToken·로딩 상태 (persist) |
| `src/Bootstrap.tsx` | 초기 로드 및 동기화 시작 |

## 실시간 협업(Yjs)과의 관계

협업 ON 페이지/DB 는 본문·구조 권위가 Y.Doc 으로 넘어가고, Y→store 반영(materialize)이
기존 sync 큐(`deferSync`)에 실려 서버로 전파된다. 즉 협업은 이 동기화 아키텍처 위에 얹힌
레이어다 — 시드·바인딩 순서, epoch 격리, materialize 방어선은
[collab/overview.md](../collab/overview.md) 가 권위 문서.

DB 원격 snapshot(`applyRemoteDatabaseToStore`/`applyRemoteDatabasesToStore`)이 최신
컬럼·프리셋·패널 구조를 store에 반영할 때, 같은 DB의 협업 Y.Doc이 활성 상태라면 반드시
동일 구조를 Y.Doc에도 reconcile해야 한다. store만 최신화하면 기존 탭/PC에 남아 있던 오래된
Y.Doc materialize가 `updatedAt=now`로 다시 서버에 올라가 속성 타입 변경을 되돌릴 수 있다.

## 관련 위키
- [collab/overview.md](../collab/overview.md) — 실시간 협업 구조·안전장치·운영
- [incremental-sync.md](incremental-sync.md) — delta/watermark 상세
- [lc-scheduler-workspace-repair.md](lc-scheduler-workspace-repair.md) — LC 스케줄러 루트 DB 페이지 결손 복구
- [page-content-load.md](page-content-load.md) — 페이지 본문 지연 로드
- [external-protected-database-load.md](external-protected-database-load.md) — 외부 DB 행 배치 로드
- [outbox.md](outbox.md)
- [conflict-resolution.md](conflict-resolution.md)
