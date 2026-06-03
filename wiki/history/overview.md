# 버전 히스토리

페이지·데이터베이스 버전 히스토리는 **서버 권위(server-authoritative)** 로 일원화돼 있다.
로컬 `historyStore` 는 거의 은퇴 상태(아래 "로컬 historyStore" 참고).

## 아키텍처 (서버 권위)

서버(AppSync + v5-resolvers Lambda + DynamoDB)가 유일한 진실이다. 클라이언트는 조회·복원만 한다.

- **기록**: `upsertPage`/`upsertDatabase` 시 서버가 diff patch + 주기 anchor 를 누적 기록.
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

> **주의 — 삭제 히스토리**: `deletedAt` 은 스냅샷 diff 로 잡히지 않으므로, `softDeletePage` 가 전용 `recordPageDeleteHistory`(kind `page.delete`, `databaseId` 포함)로 별도 기록한다. 이게 빠지면 삭제가 히스토리에 안 남고 페이지 탭에도 안 보인다.

> **주의 — rowPageOrder**: 서버 Database 모델에 `rowPageOrder` 가 없다. 페이지에서 역추적해 재구성한다(`storeApply.ts` `collectRowPageIdsForDatabase` / `ensurePageInDatabaseRowOrder` / `removePageIdFromDatabaseRowOrder`).

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

## 로컬 historyStore (`src/store/historyStore.ts`)

서버 일원화로 거의 사용하지 않는다.
- `recordDbEvent` 는 `db.create` 베이스라인만 기록(나머지 no-op). `repairDbHistoryBaselineIfNeeded` 가 이 베이스라인 유무로 재시드 판단.
- `recordPageEvent` 는 no-op.
- **살아있는 기능**: 삭제-행 톰스톤(`recordDeletedRowTombstone`/`restoreDeletedRowFromHistory`/`getDeletedRowTombstones`) — 표 뷰의 행 복구에 사용.
- 신규 히스토리 기능은 로컬에 의존하지 말고 서버(page/database-history) 경로로 추가할 것.

## 배포

스키마/GSI/Lambda 변경 시: `cd infra && npm run deploy`. 프런트만 바뀌면 프런트 재빌드/배포.
