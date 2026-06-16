# DB row index 캐시

DB row를 100개 단위로만 본문 로드하면, 아직 로드되지 않은 최신 row가 필터·정렬·검색 후보에서 빠진다. 이 문제를 막기 위해 DB별로 가벼운 row index를 로컬 캐시에 저장하고, 뷰 계산은 본문 로드 여부와 무관하게 이 index를 후보군으로 사용한다.

## 핵심 파일

| 파일 | 역할 |
|------|------|
| `src/lib/database/databaseRowIndexCache.ts` | row index entry 정규화, 캐시 read/write/remove |
| `src/store/databaseRowIndexStore.ts` | DB별 row index snapshot 세션 store + 로컬 캐시 hydrate |
| `src/components/database/useProcessedRows.ts` | `rowPageOrder`와 row index 후보를 합쳐 필터·정렬·검색 입력 생성 |
| `src/components/database/databaseRowSources.ts` | `pageStore` row 우선, 없으면 row index entry로 fallback row 생성 |
| `src/lib/sync/externalProtectedDatabaseLoad.ts` | 첫 row batch 적용 후 남은 row index를 백그라운드 페이지네이션으로 warm-up |
| `src/lib/sync/queries/page.ts` | `LIST_DATABASE_ROW_INDEX` GraphQL query |
| `src/lib/sync/bootstrap.ts` | `fetchDatabaseRowIndexBatch()` |
| `src/components/database/useOpenDatabaseRow.ts` | cached-only row 클릭 시 본문 로드 보장 |

## 캐시 데이터

`DatabaseRowIndexEntry`는 화면 후보 계산에 필요한 최소 필드만 가진다.

```ts
{
  pageId: string;
  workspaceId: string;
  databaseId: string;
  title: string;
  icon: string | null;
  order: number;
  dbCells?: Record<string, CellValue>;
  updatedAt: number;
}
```

로컬 캐시 키는 `quicknote.database-row-index.cache.${encodeURIComponent(indexKey)}.v1` 형식이다. `indexKey`는 `resolveDatabaseRowRemoteKey(databaseId, currentWorkspaceId)` 결과이며, 보호 DB는 canonical DB ID를 사용한다.

## 로드 흐름

1. 화면 진입 시 `ensureExternalProtectedDatabaseLoaded()`가 첫 row 본문 batch를 가져온다.
2. 첫 batch는 기존처럼 `pageStore`/`databaseStore`에 적용한다.
3. 첫 batch가 비어 있으면 인라인 연결 DB의 빈 화면을 막기 위해 `fetchDatabaseRowIndexBatch()`를 fallback으로 호출해 cached-only 후보군을 만든다.
4. `nextToken`이 있으면 `fetchDatabaseRowIndexBatch()`로 남은 row index만 백그라운드에서 순차 로드한다.
5. `useDatabaseRowIndexStore.upsertRows()`가 snapshot을 갱신하고 로컬 캐시에 저장한다.
6. `useProcessedRows()`는 `bundle.rowPageOrder`와 row index pageId를 합쳐 후보군을 만들고, `databaseRowSources`가 row index fallback을 제공한다.
7. 필터·정렬·검색은 전체 row index 후보군 기준으로 즉시 계산된다.

## row 클릭 안전장치

row index fallback row는 본문 `doc`이 없다. 따라서 row 열기는 반드시 `useOpenDatabaseRow(databaseId)` 또는 `useEnsureDatabaseRowContent(databaseId)`를 통해야 한다.

- table/list/kanban/gallery/timeline row open은 `useOpenDatabaseRow`를 사용한다.
- kanban의 전체 화면 열기는 `useEnsureDatabaseRowContent` 성공 후 `setActivePage`/`setCurrentTabPage`를 호출한다.
- `ensurePageContentLoaded()`가 실패하면 placeholder row가 있어도 피커뷰를 열지 않는다.
- 실패 시 `"항목 페이지를 불러오지 못했습니다."` toast를 표시한다.

## refresh 정책

row index 전체를 로컬 캐싱하는 구조에서는 사용자가 실수로 전체 DB를 다시 받는 버튼을 제공하지 않는다.

- `DatabaseToolbarControls`의 서버 데이터 refresh 버튼은 제거한다.
- `refreshDatabaseRowsFromServer()`와 `resolveDatabaseRefreshRowLimit()` 같은 강제 refresh 전용 API는 두지 않는다.
- 서버 동기화는 첫 batch + 백그라운드 row index warm-up + 일반 sync 적용으로 갱신한다.
- 수동 복구가 필요하면 별도 진단/복구 흐름을 만들고, 일반 toolbar 버튼으로 노출하지 않는다.

## 주의사항

- row index는 후보군과 셀 기반 필터·정렬용이다. 페이지 본문 렌더링 source of truth는 여전히 `pageStore`의 실제 page다.
- `pageStore`에 실제 page가 있으면 row index fallback보다 우선한다.
- template row는 `_qn_isTemplate === "1"`이면 index에서 제외한다.
- scoped protected DB의 assignee/member 경로는 서버 nextToken 특성상 무한 warm-up을 보수적으로 다룬다. scope 없는 일반 DB와 보호 DB canonical key를 우선 검증한다.
- `visibleRowLimit`/더보기 판단 시 `rowPageOrder.length`만 보지 말고 row index count까지 포함해야 버튼이 사라지지 않는다.
- `useProcessedRows`는 컬럼 분류(title/non-title/derived)를 행 루프 밖 `columnPlan`(useMemo, deps=`bundle`)으로 1회 캐싱한다. 행마다 `bundle.columns` 재순회·`isCellValueDerived` 재평가하던 비용을 제거(behavior-preserving: derived 1차 → 전 non-title filterable 2차 순서·입력 동일). 행 루프 안에서 컬럼 배열을 다시 순회/분류하지 말 것.

## 검증

- `src/components/database/__tests__/databaseRowSources.test.ts`
- `src/components/database/__tests__/useOpenDatabaseRow.test.tsx`
- `src/lib/sync/__tests__/externalProtectedDatabaseLoad.test.ts`
- `src/components/database/__tests__/databaseRowLimit.test.ts`
