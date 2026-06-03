# historyStore

## 역할
페이지·DB의 버전 히스토리와 삭제된 DB 행의 tombstone을 관리하는 스토어.

## 위치
`src/store/historyStore.ts`

## State 타입

| 필드 | 타입 | 설명 |
|------|------|------|
| `pageHistory` | `Record<string, PageHistoryEvent[]>` | pageId 별 히스토리 이벤트 목록 |
| `dbHistory` | `Record<string, DbHistoryEvent[]>` | databaseId 별 히스토리 이벤트 목록 |
| `deletedRowTombstonesByDbId` | `Record<string, DeletedRowTombstone[]>` | DB별 삭제된 행 tombstone (복원용) |

## 액션 목록

| 액션명 | 파라미터 | 설명 |
|--------|---------|------|
| `recordPageAnchor` | `pageId, snapshot` | 페이지 히스토리 앵커 이벤트 기록 |
| `getPageTimeline` | `pageId` | 해당 페이지의 히스토리 이벤트 목록 반환 |
| `restorePageFromEvent` | `pageId, eventId` | 특정 이벤트 시점의 페이지 스냅샷 반환 |
| `recordDbEvent` | `databaseId, event` | DB 히스토리 이벤트 기록 |
| `getDbTimeline` | `databaseId` | 해당 DB의 히스토리 이벤트 목록 반환 |
| `getDeletedDbRestorePoints` | 없음 | 복원 가능한 DB 목록 반환 |
| `pushDeletedRowTombstone` | `row` | 삭제된 DB 행 tombstone 추가 |
| `popDeletedRowTombstone` | `databaseId, tombstoneId` | tombstone 꺼내기 (복원 후 제거) |

## Persist

- storage: `deferredHistoryStorage` (커스텀 deferred 스토리지)
- 보존 정책: `HISTORY_RETENTION_MAX_AGE_MS` 이상 오래된 이벤트 자동 정리
- 최대 이벤트 수: `HISTORY_RETENTION_MAX_EVENTS` 초과 시 오래된 항목부터 삭제
- DB 히스토리 주의: `db.create` 이벤트는 가장 오래됐더라도 보존 (삭제 시 `mergeDbPatch` 실패 방지)
- 마이그레이션 필요 조건: `PageSnapshot`, `DatabaseSnapshot` 타입 변경 시

## 의존 관계

- `src/lib/storage/index.ts` — `makeDeferredStorage`
- `pageStore` — `updateDoc` 에서 `shouldWriteAnchor` 호출, `restorePageFromLatestHistory` / `restorePageFromHistoryEvent` 에서 히스토리 조회
- `src/store/pageStore/helpers.ts` — `toPageSnapshot`

## 사용처 (주요 컴포넌트)

- `src/store/pageStore.ts` — 페이지 본문 저장 시 히스토리 앵커 기록 및 복원
- `src/components/VersionHistoryPanel.tsx` (또는 유사 패널) — 버전 히스토리 UI 표시
- `src/lib/sync/storeApply.ts` — 원격 DB 이벤트 적용 시 히스토리 기록
