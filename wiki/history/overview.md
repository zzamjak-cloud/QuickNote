# 버전 히스토리

페이지·데이터베이스 버전 히스토리는 **서버 권위(server-authoritative)** 로 일원화돼 있다.
로컬 `historyStore` 는 거의 은퇴 상태(아래 "로컬 historyStore" 참고).

## 세션 머지 모델 (2026-06-12 개편)

upsert 마다 1버전이 아니라 **편집 세션 1건 = 버전 1건**(`page.session`/`database.session`).
협업(Yjs) materialize 가 1.8s 마다 upsert 를 보내도 버전이 폭증하지 않는다.

- **세션 경계**: idle **15분** 또는 세션 최대 **60분**(`historySession.ts` `SESSION_IDLE_MS`/`SESSION_MAX_MS`).
  별도 스케줄러 없음 — 경계 밖 첫 upsert 가 새 엔트리를 연다. 열린 세션은 같은 historyId 를 in-place 갱신.
- **no-op 필터** (`diffMeaningfulPageUnits`/`diffMeaningfulDatabaseUnits`): 빈 블럭 생성·삭제,
  동일 내용 블럭의 위치 이동(밀림), `order`·`blockComments`(읽음 시각)·`panelState`·`updatedAt` 변화는
  버전을 만들지 않는다. 블럭 매칭은 TipTap uniqueId(`attrs.id`), id 없으면 내용 시그니처 폴백.
- **엔트리 필드**: `snapshot`(post-state 전체 — patch 재생 불필요), `changedUnits`("block:<id>"|"cell:<colId>"|
  "column:<id>"|"preset:<id>"|"meta:*"), `contributors`(세션 참여자 누적), `sessionStartedAt`/`lastActivityAt`.
  `patch` 는 직전 엔트리 post-state 기준 누적 합성으로 계속 기록(레거시 patch 체인 워커 호환).
- **최종 편집자**: 세션의 `createdByMemberId/Name` = 마지막 upsert caller(= Yjs `lastEditedBy` 와 동일 소스).
  동시 머지 race 는 LWW(본문은 CRDT/서버 권위로 수렴, 손실은 귀속 메타뿐).
- **UI**: 본문 diff 는 `BlockDiffView`(generateHTML 정적 렌더, 실제 블럭 모습 + 추가=초록/삭제=빨강/변경=노랑),
  DB 구조는 `DatabaseStructureDiffView`(컬럼 칩 스트립). 목록 요약은 `summarizeChangedUnits`.
  진행 중 세션(15분 내 활동)은 "편집 중" 배지.
- **⚠ 배포 순서**: `snapshot` 등 신규 필드는 클라 쿼리가 select 한다 — **CDK(스키마) 선배포 후 프론트**
  (PageMeta FieldUndefined 사고와 동일 규칙).
- 구(patch/anchor) 엔트리는 읽기 전용 레거시로 공존 — 재구성 경로가 snapshot 우선, 없으면 anchor+patch 폴백.
- Y.Snapshot/룸 update 로그 기반 히스토리는 **채택하지 않음**: gc:false 비대화, rt-ydoc-updates 50건 압축,
  epoch bump 시 룸 세대 폐기(히스토리 증발) 때문. 버전 영속은 항상 이 서버 테이블이다.

## 아키텍처 (서버 권위)

서버(AppSync + v5-resolvers Lambda + DynamoDB)가 유일한 진실이다. 클라이언트는 조회·복원만 한다.

- **기록**: `upsertPage`/`upsertDatabase` 시 서버가 세션 머지 기록(위 절). 신규 엔트리는 전체 `snapshot` 보유.
  - 페이지 삭제(`softDeletePage`)도 `page.delete` 히스토리를 남긴다(아래 주의 참고).
- **저장 테이블** (`infra/lib/sync-stack.ts`)
  - `quicknote-page-history`: PK `pageId`, SK `historyId`
    - GSI `byWorkspaceAndCreatedAt`
    - GSI `byDatabaseAndCreatedAt` (PK `databaseId`) — **DB 소속 row 페이지 변경을 단일 쿼리로 모으기 위함**. `databaseId` 보유 항목(=row 페이지)만 색인.
  - `quicknote-database-history`: PK `databaseId`, SK `historyId` (+ `byWorkspaceAndCreatedAt`, `byOwnerAndCreatedAt`)
  - 삭제된 DB(휴지통): `quicknote-database` 테이블 GSI `byWorkspaceAndDeletedAt`
- **서버 kind**: `page.create/update/delete/restoreVersion`, `database.create/update/delete/restoreVersion`

## 두 투영 (DB 히스토리 뷰)

DB 히스토리는 한 화면에서 두 탭으로 본다 (`DatabaseBlockHistoryDialog`):

| 탭 | 내용 | 데이터 소스 |
|----|------|------------|
| **DB구조** | 컬럼/이름/필터/뷰 등 DB 스냅샷 버전 | `serverDatabaseHistoryStore` (`listDatabaseHistory`) |
| **페이지** | 그 DB 소속 row 페이지들의 생성/수정/삭제 | `serverDatabaseRowHistoryStore` (`listDatabaseRowHistory`, GSI 단일 쿼리·서버 페이지네이션) |

- 두 탭 모두 **좌측 인라인 프리뷰**(diff) + **복원** 을 제공한다. 페이지 탭은 더 이상 중첩 팝업을 열지 않는다.
- 팝업은 **고정 크기**(`h-[86vh]`) — 탭 전환 시 출렁이지 않는다.
- 리스트는 "버전 N" 이 아니라 **변경 요약**("컬럼 추가 외 2건" 등)을 표시(`summarizePreviewChanges`). 첫 버전은 "DB 생성"/"페이지 생성" 라벨로 폴백.
- 페이지 항목 라벨 색상: **삭제=빨강, 생성=파랑** (`historyLabelColorClass`).

## 복원 / 삭제 복구

- **페이지(행) 복원**: `serverPageHistoryStore.restorePageHistoryEvent` → 서버 `restorePageVersion`(deletedAt 해제·스냅샷 복원) → `applyRemotePageToStore` 가 `rowPageOrder` 에 재연결.
- **삭제된 행 복구**: ① 페이지 탭에서 그 행 선택 → "이 버전으로 복원", 또는 ② 표 뷰의 톰스톤 "복구" 버튼(`restoreDeletedRowFromHistory`).
- **삭제된 DB 복구**: `DatabaseManagerDialog` → 서버 휴지통(`listTrashedDatabases`/`restoreDatabase`, `serverTrashedDatabaseStore`).

> **CRITICAL 회귀 주의 — 삭제 가드**: 페이지/DB 삭제 시 `markLocallyDeletedEntity` 로 로컬 삭제 가드가 걸려 strict 창 동안 원격 스냅샷을 차단한다. **복원 경로는 반드시 `clearLocalDeleteGuard(...)` 를 호출**해야 복원본이 무시·`rowPageOrder` 제거되지 않는다. (`serverPageHistoryStore.restorePageHistoryEvent`, `databaseStore.restoreDeletedRowFromHistory`)

> **CRITICAL 회귀 주의 — restorePageVersion 정제**: `restorePageVersion` 핸들러는 히스토리 스냅샷을 `PutCommand`로 직접 저장한다. 스냅샷에 `databaseId: null`이 포함되면 `byDatabaseAndOrder` GSI가 `"Type mismatch actual:NULL"` 에러를 던진다. **`PutCommand` 전에 반드시 `databaseId null 제거` + `normalizePageOrderField` + `deriveDatabaseRowScopeKeys`를 적용해야 한다** (`upsertPage`와 동일 정제 로직). 이 처리가 없으면 일반 페이지(databaseId 없음)의 버전 복원이 항상 실패한다.

> **주의 — 삭제 히스토리**: `deletedAt` 은 스냅샷 diff 로 잡히지 않으므로, `softDeletePage` 가 전용 `recordPageDeleteHistory`(kind `page.delete`, `databaseId` 포함)로 별도 기록한다. 이게 빠지면 삭제가 히스토리에 안 남고 페이지 탭에도 안 보인다.

> **주의 — rowPageOrder**: 서버 Database 모델에 `rowPageOrder` 가 없다. 페이지에서 역추적해 재구성한다(`storeApply.ts` `collectRowPageIdsForDatabase` / `ensurePageInDatabaseRowOrder` / `removePageIdFromDatabaseRowOrder`).

> **주의 — 복원 직후 `null.type` 크래시**: 복원된 doc 의 `content` 배열에 null 항목이 있으면 에디터 헤더 렌더 중 `Cannot read properties of null (reading 'type')` 로 터진다. `gqlPageToLocalPage`(`storeApply/helpers.ts`)가 `parseAwsJson` 후 `content.filter(Boolean)` 로 null 노드를 거른다. 서버 데이터 자체는 정상이라 새로고침하면 복구되지만, 이 가드로 복원 직후 전환 렌더에서도 크래시를 막는다.

## 휴지통 영구삭제 — DynamoDB TTL (`purgeAt`)

휴지통 30일 만료 영구삭제는 **Pages 테이블의 DynamoDB TTL** 이 처리한다(WCU 무과금). 기존의 `trash-purge` Lambda 일일 풀스캔은 제거됐다.

- `softDeletePage` 가 `purgeAt = floor((Date.now() + 30일) / 1000)` (epoch **초**)를 기록 → 그 시각이 지나면 DynamoDB 가 자동 영구삭제(최대 48h 지연).
- Pages 테이블 TTL 속성 = `purgeAt` (`createSyncTable(... { ttlAttribute: "purgeAt" })`).
- `trashPurgeFn` Lambda 자체는 수동 invoke 용으로 남아 있으나, EventBridge 스케줄(`TrashPurgeSchedule`)은 제거됨.

> **CRITICAL 회귀 주의 — purgeAt**
> - `purgeAt` 은 반드시 epoch **초**(밀리초 아님). 잘못 넣으면 TTL 미동작 또는 즉시 삭제.
> - **복원·upsert 경로는 `purgeAt` 을 제거해야 한다.** `restorePage` 는 `delete next["purgeAt"]`; `upsertPage` 의 blind Put 은 입력에 purgeAt 이 없으면 자연 제거된다. 안 지우면 복원해도 만료 시각에 삭제된다.
> - Databases 테이블엔 TTL 이 없다(페이지만). `softDeleteRecord` 의 `ttlSeconds` 는 페이지 호출에서만 전달.
> - 배포·기존 휴지통 백필 절차: [infra/cost-optimization-deploy.md](../infra/cost-optimization-deploy.md) #1 + `infra/scripts/backfill-purge-at.ts`.

## 핵심 파일

| 파일 | 역할 |
|------|------|
| `infra/lambda/v5-resolvers/handlers/pageDatabase.ts` | 서버 히스토리 기록·조회·복원(`recordPageHistory`/`recordPageDeleteHistory`/`listDatabaseRowHistory`/`restorePageVersion`/`restoreDatabase`/`listTrashedDatabases` 등) |
| `infra/lib/sync/schema.graphql`, `infra/lib/sync-stack.ts` | 스키마·테이블·GSI·리졸버 와이어링 |
| `src/store/serverPageHistoryStore.ts` | 페이지 히스토리(서버) 조회·복원 |
| `src/store/serverDatabaseHistoryStore.ts` | DB 구조 히스토리(서버) |
| `src/store/serverDatabaseRowHistoryStore.ts` | DB 소속 row 페이지 변경 집계(GSI 단일 쿼리) |
| `src/store/serverTrashedDatabaseStore.ts` | 삭제된 DB 휴지통 목록·복원 |
| `src/components/database/DatabaseBlockHistoryDialog.tsx` | DB 히스토리 팝업(DB구조/페이지 2탭, 인라인 프리뷰) |
| `src/components/history/PageHistoryPreviewDialog.tsx` | 개별 페이지 히스토리 팝업 |
| `src/lib/history/historyPreviewDiff.ts` | diff 계산 + `summarizePreviewChanges` |
| `src/lib/history/pageHistoryPatch.ts`, `databaseHistoryPatch.ts` | 서버 patch/anchor → 스냅샷 재구성(localStorage 캐시) |
| `src/lib/sync/pageHistoryApi.ts`, `databaseHistoryApi.ts`, `trashApi.ts` | GraphQL 호출 래퍼 |

## 성능 — 스냅샷 재구성·렌더 (회귀 주의)

페이지/DB 히스토리 팝업은 patch/anchor 로 스냅샷을 재구성한다. 과거 다음 3가지가 겹쳐 팝업이 심하게 렉이 걸렸다(서버 통신 빈도 문제가 아니라 메인 스레드 동기 처리 폭주):

1. **`buildPageHistorySnapshotMap` localStorage 캐시 thrashing** — 엔트리마다 캐시 전체(최대 300개)를 `JSON.parse`(read)하고 미스 시 `.sort()` 후 전체를 `JSON.stringify`(write)했다 → O(엔트리×캐시) 대용량 직렬화. **빌드당 read 1회 / write 1회**로 변경(`pageHistoryPatch.ts` `readCacheMap`/`writeCacheMap`). 캐시 히트 스냅샷은 읽기 전용으로 공유하고, 다음 패치는 `applyPagePatch` 가 base 를 clone 한 뒤 적용하므로 오염되지 않는다(테스트: `src/lib/history/__tests__/pageHistoryPatch.test.ts`).
2. **렌더마다 맵 통째 재빌드** — `selectedBefore` 가 `getPreviousPageHistorySnapshot`(내부에서 맵 전체 재빌드)을 useMemo 없이 호출 → 매 렌더 재빌드. 이미 만든 `snapshotMap` 에서 이전 버전 id 를 조회하도록 useMemo 화(`PageHistoryPreviewDialog.tsx`).
3. **셀렉터가 매 호출 새 배열 반환** — `useServerPageHistoryStore((s) => s.getPageTimeline(pageId))` 는 `.map()` 으로 매번 새 배열을 만들어 zustand 스냅샷이 불안정 → 잦은 리렌더(→ 위 2 반복). 원본 배열을 셀렉터로 받아 `buildPageTimeline`(store export)을 `useMemo` 로 감싸도록 변경(`PageHistoryPreviewDialog.tsx`, `PageListItem.tsx`).

> 캐시 수정(#1)은 `DatabaseBlockHistoryDialog`(DB 히스토리)에도 동일 적용된다.

## 로컬 historyStore (`src/store/historyStore.ts`)

서버 일원화로 거의 사용하지 않는다.
- `recordDbEvent` 는 `db.create` 베이스라인만 기록(나머지 no-op). `repairDbHistoryBaselineIfNeeded` 가 이 베이스라인 유무로 재시드 판단.
- `recordPageEvent` 는 no-op.
- **살아있는 기능**: 삭제-행 톰스톤(`recordDeletedRowTombstone`/`restoreDeletedRowFromHistory`/`getDeletedRowTombstones`) — 표 뷰의 행 복구에 사용.
- 신규 히스토리 기능은 로컬에 의존하지 말고 서버(page/database-history) 경로로 추가할 것.

## 배포

스키마/GSI/Lambda 변경 시: `cd infra && npm run deploy`. 프런트만 바뀌면 프런트 재빌드/배포.
