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

### 네트워크 복구 시
```
window 'online' 이벤트
  → AppSync 구독 즉시 재연결
  → delta 또는 full 재페치 (fetchMode 결정)
  → outbox flush (오프라인 중 쌓인 mutations 전송)
```

## 동기화 엔티티 추가 시 등록점 (단일화)

새 완전동기화 엔티티/op 추가는 **세 등록점**만 수정하면 된다. 분산 분기를 흩지 말 것.

1. `src/lib/sync/outbox/types.ts` — `OutboxOp` union + (신규 엔티티면) `OutboxEntityType`.
2. `src/lib/sync/syncOpRegistry.ts` — `SYNC_OP_REGISTRY[op]` 항목. `execute`/`isDelete`/`supersededUpsertOp`/`tombstoneEntity` 와 **메타 플래그 3종**(`workspaceScoped`/`capturesBaseVersion`/`warnIfMissingWorkspace`)을 채운다. `outboxMeta.ts` 는 이 플래그로 구동되므로 별도 switch 추가 금지.
3. (서버 푸시를 받는 엔티티면) `src/lib/sync/subscribers.ts` 의 `channels` 디스크립터 배열에 `{key,query,enabled,onNext}` 1건 + `SubscribeHandlers` 핸들러.

회귀 체크: op 추가 후 `outboxMeta.ts` 가 컴파일되면(누락 플래그는 타입 에러) 메타가 자동 채워진다. `apply`(storeApply LWW)는 의도적으로 이 레지스트리에 넣지 않는다(거대 핫로직, Phase 5.6 분할 대상).

## 핵심 파일

| 파일 | 역할 |
|------|------|
| `src/lib/sync/engine.ts` | IndexedDB outbox, 뮤테이션 전송, 재시도 |
| `src/lib/sync/syncOpRegistry.ts` | op→엔티티 배선·메타 플래그 단일 등록점 |
| `src/lib/sync/subscribers.ts` | AppSync WebSocket 구독 재연결 |
| `src/lib/sync/storeApply.ts` | LWW 충돌 해결 |
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

## 관련 위키
- [collab/overview.md](../collab/overview.md) — 실시간 협업 구조·안전장치·운영
- [incremental-sync.md](incremental-sync.md) — delta/watermark 상세
- [lc-scheduler-workspace-repair.md](lc-scheduler-workspace-repair.md) — LC 스케줄러 루트 DB 페이지 결손 복구
- [page-content-load.md](page-content-load.md) — 페이지 본문 지연 로드
- [external-protected-database-load.md](external-protected-database-load.md) — 외부 DB 행 배치 로드
- [outbox.md](outbox.md)
- [conflict-resolution.md](conflict-resolution.md)
