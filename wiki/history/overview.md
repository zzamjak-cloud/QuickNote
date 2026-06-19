# 버전 히스토리

페이지·데이터베이스 버전 히스토리는 **서버 권위(server-authoritative)** 로 일원화돼 있다.
로컬 `historyStore` 는 거의 은퇴 상태(아래 "로컬 historyStore" 참고).

## 세션 머지 모델 (2026-06-12 개편)

upsert 마다 1버전이 아니라 **편집 세션 1건 = 버전 1건**(`page.session`/`database.session`).
협업(Yjs) materialize 가 1.8s 마다 upsert 를 보내도 버전이 폭증하지 않는다.

- **세션 경계**: idle **10분** 또는 세션 최대 **20분**(`historySession.ts` `SESSION_IDLE_MS`/`SESSION_MAX_MS`,
  Google Docs/Notion 류 활동 기반 체크포인트 캐던스 — 활발히 편집해도 20분마다 버전 확정).
  별도 스케줄러 없음 — 경계 밖 첫 upsert 가 새 엔트리를 연다. 열린 세션은 같은 historyId 를 in-place 갱신.
  세분화 기록은 로컬 Yjs(IDB+undo 히스토리)가 담당 — 서버 버전과 역할 분리.
- **no-op 필터** (`diffMeaningfulPageUnits`/`diffMeaningfulDatabaseUnits`): 빈 블럭 생성·삭제,
  동일 내용 블럭의 위치 이동(밀림), `order`·`blockComments`(읽음 시각)·`panelState`·`updatedAt` 변화는
  버전을 만들지 않는다. 블럭 매칭은 TipTap uniqueId(`attrs.id`), id 없으면 내용 시그니처 폴백.
- **DB 행 멤버십 변경은 독립 버전** (2026-06-19 Phase B-1 `a7abd0bd`/`0ee56aeb`): `diffMeaningfulDatabaseUnits`
  가 `rowPageOrder` 비교로 행 추가/삭제를 `"rows"` changedUnit 으로 잡고, `recordDatabaseHistory` 가
  `isRowMembershipChange`(changedUnits 에 `"rows"` 포함)면 **세션 머지를 우회해 독립 버전**으로 기록한다.
  세션에 묻히면 행 추가/삭제가 안 보이고 삭제 복구 추적이 끊기기 때문. (DB구조 일반 변경은 기존대로 세션 머지.)
- **엔트리 필드**: `snapshot`(post-state 전체 — patch 재생 불필요), `changedUnits`("block:<id>"|"cell:<colId>"|
  "column:<id>"|"preset:<id>"|"meta:*"), `contributors`(세션 참여자 누적), `sessionStartedAt`/`lastActivityAt`.
  `patch` 는 직전 엔트리 post-state 기준 누적 합성으로 계속 기록(레거시 patch 체인 워커 호환).
- **최종 편집자**: 세션의 `createdByMemberId/Name` = 마지막 upsert caller(= Yjs `lastEditedBy` 와 동일 소스).
  동시 머지 race 는 LWW(본문은 CRDT/서버 권위로 수렴, 손실은 귀속 메타뿐).
- **UI** (2026-06-19 통합 프리뷰 개편 `769debb6`/`b35e4228`): 본문 프리뷰는 `UnifiedBlockDiffView`
  (`BlockDiffView.tsx`) — **read-only TipTap 에디터**(실제 스키마+NodeView)로 **전체 본문을 단일 뷰**로
  렌더하고 변경분만 인라인 하이라이트한다(좌/우 두 패널 분할 아님 — 옛 방식 폐기). 탭 블럭·DB 블럭 등 React
  NodeView 블럭도 본래 모습 그대로 보인다(정적 generateHTML 아님). 라벨/배지/박스 없이 **컬러만**
  (빨강=삭제 / 초록=추가). 인라인 DB 블럭은 프리뷰에서 전체 DB 를 렌더하지 않고 컴팩트 플레이스홀더로 대체(`toPreviewBlock`).
  DB 구조는 `DatabaseStructureDiffView`(컬럼 칩 스트립). 목록 요약은 `summarizeChangedUnits`.
  진행 중 세션(**10분** 내 활동 = 서버 `SESSION_IDLE_MS`)은 "편집 중" 배지(`Date.now()` 는 effect 로 고정 — react-hooks/purity).
- **⚠ null 기본값 attr 정규화 (CRITICAL 회귀)**: `editor.getJSON` 은 기본값 attr 을 `textAlign: null` 처럼
  포함하고, 협업 materialize(`yDocToJson`/y-prosemirror)는 **null 기본값을 생략**한다. 시그니처 비교가
  `{textAlign: null}` ≠ `{}` 로 갈리면 멘션 하나 추가에도 **전 블럭이 modified 로 오판**된다(인라인 DB 까지
  diff 에 끌려나옴). `normalizeForSignature`(attrs/marks 의 null 키 깊이 제거)를 **반드시 통과**시켜야 한다.
  2026-06-14 이후 이 함수(및 `blockSignature`/`stableStringify` 등)는 **공유 코어 `src/lib/history/signatureCore.ts`**
  단일 정의로 통합됐고 클라(`blockDiff.ts`)·서버(`historySession.ts`)가 같은 소스를 import 한다 — 아래 "공통 시그니처 코어" 절 참고. **분기시키지 말 것.**
- **⚠ 배포 순서**: `snapshot` 등 신규 필드는 클라 쿼리가 select 한다 — **CDK(스키마) 선배포 후 프론트**
  (PageMeta FieldUndefined 사고와 동일 규칙).
- **⚠ 협업 모드 본문 영속 의존성**: 협업 ON 페이지는 materialize 의 `updateDoc(deferSync)` 가 sync enqueue 를
  생략하므로, 서버 `page.doc` 업서트가 없으면 **히스토리가 아예 안 쌓인다.** `useCollabSession` 의 주기 업서트
  (로컬 편집 시 8s 간격 + 페이지 이탈 flush)가 이를 담당 → [`collab/overview.md`](../collab/overview.md) 참고.
- 구(patch/anchor) 엔트리는 읽기 전용 레거시로 공존 — 재구성 경로가 snapshot 우선, 없으면 anchor+patch 폴백.
  이번 개편 이전에 "전체 변경"으로 기록된 세션은 그대로 남는다(새 기록부터 정상). 거슬리면 목록에서 선택 삭제.
- Y.Snapshot/룸 update 로그 기반 히스토리는 **채택하지 않음**: gc:false 비대화, rt-ydoc-updates 50건 압축,
  epoch bump 시 룸 세대 폐기(히스토리 증발) 때문. 버전 영속은 항상 이 서버 테이블이다.

## 공통 시그니처 코어 / patch 엔진 (2026-06-14 통합, `a5527b5e`)

페이지·DB 히스토리는 시그니처 계산과 patch→스냅샷 재구성을 **단일 공유 코어**로 돌린다. behavior-preserving 리팩토링 — 외부 동작 불변, 중복 정의만 제거했다.

### 공통 시그니처 코어 — `src/lib/history/signatureCore.ts`
의존성 0(에디터/store/lambda 어느 것에도 안 묶임) 순수 모듈. `isPlainObject`/`parseJsonLike`/`stableStringify`(`signatureCore.ts:17`)/`hashString`/`isEmptyBlockNode`/`normalizeForSignature`(`signatureCore.ts:56`)/`blockSignature`(`signatureCore.ts:75`)를 export.

- **클라**: `blockDiff.ts:12-19` 가 import(+ `isEmptyBlockNode` 재export).
- **서버**: `historySession.ts:14-21` 가 상대경로 `../../../../src/lib/history/signatureCore` 로 import — **infra Lambda 빌드가 src 를 직접 참조**한다.
- 이전엔 `blockDiff.ts` 와 `historySession.ts` 에 동일 7함수가 **복붙**돼 있었다(각각 ~80줄). 이제 한 곳.

> **⚠ CRITICAL 회귀 가드 — 클라↔서버 시그니처 동일성**
> 시그니처 코어가 클라/서버에서 어긋나면 멘션 한 글자 추가에도 전 블럭이 modified 로 오판되거나(인라인 DB 까지 diff 에 끌려나옴), 협업 materialize 경로에서 **유령·누락 버전**이 생긴다(과거 사고의 핵심 원인). 그래서 두 정의를 합쳤다. **`signatureCore.ts` 를 한쪽 전용으로 분기·복제하지 말 것.** 규칙(특히 `normalizeForSignature` 의 null 키 제거)을 바꿀 때는 이 단일 파일만 고치면 양측이 자동으로 동기화된다.

### 제네릭 patch 엔진 — `src/lib/history/historyPatchEngine.ts`
`createHistoryPatchEngine<TEntry, TSnapshot>(options)`(`historyPatchEngine.ts:167`) 가 patch/anchor→스냅샷 재구성 + localStorage 캐시(`readCacheMap`/`writeCacheMap`)를 제공한다.

- **페이지**: `pageHistoryPatch.ts:5` 가 `cacheKey` 만 주입해 인스턴스화. `buildPageHistorySnapshotMap`/`getPreviousPageHistorySnapshot` 은 이제 엔진 위임 래퍼.
- **DB**: `databaseHistoryPatch.ts:17` 가 `cacheKey: "quicknote.databaseHistoryPreview.v1"` 로 동일 인스턴스화.
- 이전엔 두 파일이 각자 patch 합성·캐시 로직을 들고 있었다(각각 ~180줄). 이제 엔진 1개.

> **batched-cache 최적화 공유**: 성능 절(#1)의 "빌드당 read 1회 / write 1회" 캐시 최적화는 원래 페이지에만 있었는데, 엔진 통합으로 **DB patch 엔진도 같은 최적화를 자동으로 받는다.** 캐시 thrashing 회귀는 이제 엔진 한 곳에서만 관리한다.

### 보편적 버전 관리 캐던스 (설계 근거)
Google Docs/Notion/Figma 모두 "키 입력마다 버전"이 아니라 **활동 기반 자동 체크포인트**다(편집이 이어지는
동안 일정 시간마다 확정, 손 떼면 세션 종료). 세분화 기록은 로컬이 담당 — 퀵노트는 Yjs 가 모든 키 입력을
IndexedDB 에 영속 + 무제한 undo 로 노출하므로 "로컬 자주 + 서버 병합" 구조가 이미 현재 아키텍처다.
별도 로컬 버전 스토어 신설은 서버 일원화 원칙(로컬 `historyStore` 은퇴, 아래 절)과 충돌하므로 피한다.
Notion 식 수동 **"현재 버전 저장"** 체크포인트는 **구현됨**(2026-06-18 `4a13069f`/`68410cfd`) — 아래 "현재 버전 저장" 절 참고.

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
- **서버 kind**: `page.create/update/delete/session/checkpoint/restoreVersion`,
  `database.create/update/delete/session/checkpoint/restoreVersion`
  (`checkpoint` = 수동 "현재 버전 저장", `restoreVersion` = 복원 기록 — 아래 절들 참고)

## 두 투영 (DB 히스토리 뷰)

DB 히스토리는 한 화면에서 두 탭으로 본다 (`DatabaseBlockHistoryDialog`):

| 탭 | 내용 | 데이터 소스 |
|----|------|------------|
| **DB구조** | 컬럼/이름/필터/뷰 등 DB 스냅샷 버전 | `serverDatabaseHistoryStore` (`listDatabaseHistory`) |
| **페이지** | 그 DB 소속 row 페이지들의 생성/수정/삭제 | `serverDatabaseRowHistoryStore` (`listDatabaseRowHistory`, GSI 단일 쿼리·서버 페이지네이션) |

- 두 탭 모두 **좌측 인라인 프리뷰**(diff) + **복원** 을 제공한다. 페이지 탭은 더 이상 중첩 팝업을 열지 않는다.
- 팝업은 **고정 크기**(`h-[86vh]`) — 탭 전환 시 출렁이지 않는다.
- 타임라인 리스트는 **"버전 N" 순차 번호**(오름차순, 가장 오래된=1)를 라벨로 쓴다(2026-06-19 `5f0f7167`,
  이전의 "변경 요약만 표시" 방식 폐기). 복원으로 만들어진 항목은 "버전 N (버전 K 복원)"로 표기하고 **파랑 강조**.
  변경 요약(`summarizePreviewChanges`, "컬럼 추가 외 2건" 등)은 보조 설명으로 함께 표시. 첫 버전은 "DB 생성"/"페이지 생성" 폴백.
- 페이지 항목 라벨 색상: **삭제=빨강, 생성=파랑** (`historyLabelColorClass`).

## 복원 / 삭제 복구

- **페이지(행) 복원**: `serverPageHistoryStore.restorePageHistoryEvent` → 서버 `restorePageVersion`
  (deletedAt 해제·스냅샷 복원) → `clearLocalDeleteGuard` → **협업 재시드** → `applyRemotePageToStore` 가 `rowPageOrder` 에 재연결.
  - **협업 ON 페이지는 store 갱신만으로 화면이 안 바뀐다** — Y룸이 본문 권위. 그래서 2026-06-18 Phase D
    (`b532ad08`)부터 복원이 **시드 흐름을 재실행**한다: `requestPageBodyRestore(pageId, doc)` 가 열린 에디터에
    **언바인딩 → Y룸 본문 교체 → 재바인딩**을 요청(에디터 없으면 false → 비협업 폴백). 행 셀은
    `restoreRowCellsToCollabDoc(databaseId, pageId, dbCells)` 로 그 시점 셀을 **DB Y룸(권위)에 주입**
    (`4a8d1f5a`, 비협업이면 no-op). `applyRemotePageToStore` 는 `preserveCollabDoc` 로 협업 본문/셀을 덮어쓰지 않는다.
- **삭제된 행 복구**: ① 페이지 탭에서 그 행 선택 → "이 버전으로 복원", 또는 ② 표 뷰의 톰스톤 "복구" 버튼(`restoreDeletedRowFromHistory`).
- **DB 구조 복원**: `serverDatabaseHistoryStore.restoreDatabaseHistoryEvent` → 서버 `restoreDatabaseVersion`
  → `applyRemoteDatabaseToStore`. DB 구조(컬럼/필터/뷰)는 Y룸 본문 권위 이슈가 없어 단순 store 반영.
- **삭제된 DB 복구**: `DatabaseManagerDialog` → 서버 휴지통(`serverTrashedDatabaseStore`,
  `fetchTrashedDatabasesBatch`/`restoreDatabaseRemote`). 2026-06-19 `bd67aa3c` 부터 **검색 필터 + 다중선택
  복원 + "필터 한정 전체선택"** 지원(필터로 좁힌 목록만 일괄 복원).

## 현재 버전 저장 (수동 체크포인트, 2026-06-18 `4a13069f`)

세션 머지(idle 10분/max 20분)를 기다리지 않고 **지금 상태를 즉시 1버전으로 확정**하는 수동 버튼.

- 페이지: `serverPageHistoryStore.savePageVersion` → `savePageVersionApi` → 서버 `savePageVersion`(handler) =
  현재 페이지를 before/after 동일로 `kind: "page.checkpoint"` 강제 기록(snapshot 보유, no-op 필터 우회).
  UI: `PageHistoryPreviewDialog`.
- DB: `serverDatabaseHistoryStore.saveDatabaseVersion` → 서버 `saveDatabaseVersion` = 현재 행 페이지를 조회해
  `rowPageOrder` 를 채운 뒤 `kind: "database.checkpoint"` 기록. UI: `DatabaseBlockHistoryDialog`.
- **AppSync 리졸버 와이어링 누락 주의**: mutation 추가 시 스키마·resolver 연결을 빠뜨리면 호출이 무음 실패한다(`68410cfd` 가 이 누락을 수정).

> **CRITICAL 회귀 주의 — 삭제 가드**: 페이지/DB 삭제 시 `markLocallyDeletedEntity` 로 로컬 삭제 가드가 걸려 strict 창 동안 원격 스냅샷을 차단한다. **복원 경로는 반드시 `clearLocalDeleteGuard(...)` 를 호출**해야 복원본이 무시·`rowPageOrder` 제거되지 않는다. (`serverPageHistoryStore.restorePageHistoryEvent`, `databaseStore.restoreDeletedRowFromHistory`)

> **CRITICAL 회귀 주의 — restorePageVersion 정제**: `restorePageVersion` 핸들러는 히스토리 스냅샷을 `PutCommand`로 직접 저장한다. 스냅샷에 `databaseId: null`이 포함되면 `byDatabaseAndOrder` GSI가 `"Type mismatch actual:NULL"` 에러를 던진다. **`PutCommand` 전에 반드시 `databaseId null 제거` + `normalizePageOrderField` + `deriveDatabaseRowScopeKeys`를 적용해야 한다** (`upsertPage`와 동일 정제 로직). 이 처리가 없으면 일반 페이지(databaseId 없음)의 버전 복원이 항상 실패한다.

> **CRITICAL 회귀 주의 — AWSJSON 이중 인코딩 (복원 본문/셀 유실)** (`cb08ee50`): `restorePageVersion` 등 일부 mutation 응답의 `doc`/`dbCells` 가 **AWSJSON 으로 이중 인코딩**되어 내려온다 → `parseAwsJson` 1회 파싱으로는 문자열이 남아 본문·셀이 통째로 유실된다. `storeApply/helpers.ts` 의 `parseAwsJson` 이 이중 인코딩을 감지해 한 번 더 파싱하도록 방어한다. (메모리 `project_version_restore_double_encode` 와 동일 사고.)

> **주의 — 삭제 행 additive 복원(Phase B-2)은 보류**: DB 버전 복원 시 그 시점에 삭제됐던 행 페이지를 휴지통에서 되살려 함께 복원하는 시도(`e141ac37`)는 **협업 Y룸 충돌로 불안정해 revert**(`7800c06f`)됐다. 현재 `restoreDatabaseVersion` 은 DB 구조만 되돌리고 삭제 행은 자동 복구하지 않는다(개별 행 복구는 페이지 탭/톰스톤 경로 사용). 재시도 시 다중 row Y룸 동시 재시드의 epoch 충돌을 먼저 해결할 것.

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
| `src/lib/history/signatureCore.ts` | **공유** 시그니처 코어(`normalizeForSignature`/`blockSignature`/`stableStringify` 등). 클라(`blockDiff.ts`)·서버(`historySession.ts`) 단일 소스. **분기 금지** |
| `src/lib/history/historyPatchEngine.ts` | **공유** 제네릭 patch 엔진 `createHistoryPatchEngine<T>`(patch/anchor→스냅샷 + batched localStorage 캐시) |
| `src/lib/history/pageHistoryPatch.ts`, `databaseHistoryPatch.ts` | 위 엔진을 `cacheKey` 주입해 인스턴스화하는 얇은 래퍼(과거엔 각자 patch/캐시 로직 보유) |
| `src/lib/sync/pageHistoryApi.ts`, `databaseHistoryApi.ts`, `trashApi.ts` | GraphQL 호출 래퍼 |

## 성능 — 스냅샷 재구성·렌더 (회귀 주의)

페이지/DB 히스토리 팝업은 patch/anchor 로 스냅샷을 재구성한다. 과거 다음 3가지가 겹쳐 팝업이 심하게 렉이 걸렸다(서버 통신 빈도 문제가 아니라 메인 스레드 동기 처리 폭주):

1. **`buildPageHistorySnapshotMap` localStorage 캐시 thrashing** — 엔트리마다 캐시 전체(최대 300개)를 `JSON.parse`(read)하고 미스 시 `.sort()` 후 전체를 `JSON.stringify`(write)했다 → O(엔트리×캐시) 대용량 직렬화. **빌드당 read 1회 / write 1회**로 변경(2026-06-14 이후 공유 엔진 `historyPatchEngine.ts` `readCacheMap`/`writeCacheMap`). 캐시 히트 스냅샷은 읽기 전용으로 공유하고, 다음 패치는 `applyPagePatch` 가 base 를 clone 한 뒤 적용하므로 오염되지 않는다(테스트: `src/lib/history/__tests__/pageHistoryPatch.test.ts`).
2. **렌더마다 맵 통째 재빌드** — `selectedBefore` 가 `getPreviousPageHistorySnapshot`(내부에서 맵 전체 재빌드)을 useMemo 없이 호출 → 매 렌더 재빌드. 이미 만든 `snapshotMap` 에서 이전 버전 id 를 조회하도록 useMemo 화(`PageHistoryPreviewDialog.tsx`).
3. **셀렉터가 매 호출 새 배열 반환** — `useServerPageHistoryStore((s) => s.getPageTimeline(pageId))` 는 `.map()` 으로 매번 새 배열을 만들어 zustand 스냅샷이 불안정 → 잦은 리렌더(→ 위 2 반복). 원본 배열을 셀렉터로 받아 `buildPageTimeline`(store export)을 `useMemo` 로 감싸도록 변경(`PageHistoryPreviewDialog.tsx`, `PageListItem.tsx`).

> 캐시 수정(#1)은 patch 엔진 통합으로 DB 히스토리(`databaseHistoryPatch.ts`)에도 자동 적용된다 — 위 "제네릭 patch 엔진" 절 참고.

## 로컬 historyStore (`src/store/historyStore.ts`)

서버 일원화로 거의 사용하지 않는다.
- `recordDbEvent` 는 `db.create` 베이스라인만 기록(나머지 no-op). `repairDbHistoryBaselineIfNeeded` 가 이 베이스라인 유무로 재시드 판단.
- `recordPageEvent` 는 no-op.
- **살아있는 기능**: 삭제-행 톰스톤(`recordDeletedRowTombstone`/`restoreDeletedRowFromHistory`/`getDeletedRowTombstones`) — 표 뷰의 행 복구에 사용.
- 신규 히스토리 기능은 로컬에 의존하지 말고 서버(page/database-history) 경로로 추가할 것.

## 배포

스키마/GSI/Lambda 변경 시: `cd infra && npm run deploy`. 프런트만 바뀌면 프런트 재빌드/배포.
