# historyStore

> 버전 히스토리는 **서버 권위**로 일원화됨. 전체 아키텍처·UI·복원 흐름은 **`wiki/history/overview.md`** 참고.
> 이 문서는 로컬 `historyStore` 의 **잔존 역할**만 다룬다.

## 역할 (대부분 은퇴)

`src/store/historyStore.ts`. 서버 일원화 후 로컬 히스토리 기록은 거의 사용하지 않는다.

- `recordPageEvent` — **no-op** (페이지 히스토리는 서버가 기록).
- `recordDbEvent` — `db.create` 베이스라인만 기록(나머지 kind 는 no-op). `repairDbHistoryBaselineIfNeeded` 가 이 베이스라인 유무로 재시드 여부를 판단한다.
- **살아있는 기능 = 삭제-행 톰스톤**: 표 뷰에서 삭제한 행을 즉시 복구하기 위한 로컬 보조 경로.

## State

| 필드 | 설명 |
|------|------|
| `pageEventsByPageId` | (사실상 미사용) |
| `dbEventsByDatabaseId` | `db.create` 베이스라인만 쌓임 |
| `deletedRowTombstonesByDbId` | DB별 삭제 행 톰스톤(복원용) — **사용 중** |

## 주요 액션 (현재 유효한 것)

| 액션 | 설명 |
|------|------|
| `recordDeletedRowTombstone(row)` | 행 삭제 시 스냅샷 톰스톤 기록 |
| `getDeletedRowTombstones(databaseId)` | 톰스톤 목록 |
| `popDeletedRowTombstone(databaseId, tombstoneId)` | 톰스톤 꺼내기(복원 후 제거) |
| `recordDbEvent(databaseId, "db.create", …)` | DB 베이스라인 기록(그 외 kind no-op) |
| `purgeDatabaseHistory(databaseId)` | DB 영구삭제 시 로컬 잔여 정리 |

> 제거됨(죽은 코드 정리): `getDbEvents`/`getDbTimeline`/`getLatestDbSnapshot`/`getDbSnapshotAtEvent`/`getDeletedDbRestorePoints` 및 DB 스냅샷 복구 헬퍼. 신규 기능은 로컬에 추가하지 말고 서버 경로로.

## Persist

- storage: `deferredHistoryStorage` (`src/lib/storage/index.ts`)
- 보존: `HISTORY_RETENTION_MAX_AGE_MS` / `HISTORY_RETENTION_MAX_EVENTS`. `db.create` 는 가장 오래돼도 보존(`trimDbEventsByRetention`).
- 마이그레이션: `HISTORY_STORE_VERSION` bump 시 (→ `wiki/store/schema-versioning.md`).

## 서버 측

서버 히스토리 스토어/테이블/복원은 `wiki/history/overview.md` 참고:
`serverPageHistoryStore`, `serverDatabaseHistoryStore`, `serverDatabaseRowHistoryStore`, `serverTrashedDatabaseStore`.
