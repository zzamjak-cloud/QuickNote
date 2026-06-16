# DatabaseTableView

## 역할
데이터베이스를 테이블(스프레드시트) 형태로 렌더링하는 뷰 컴포넌트. 열 헤더, 행 셀 인라인 편집, 체크박스 행 선택, 셀 fill-drag(값 복사 드래그), 열 추가/재정렬/숨기기를 담당한다.

## 위치
`src/components/database/views/DatabaseTableView.tsx`

## 주요 exports
| 이름 | 종류 | 설명 |
|------|------|------|
| `DatabaseTableView` | React 컴포넌트 | 테이블 뷰 루트 (DatabaseBlockView에서 lazy import) |

## Props
| 속성 | 타입 | 설명 |
|------|------|------|
| `databaseId` | `string` | 렌더링할 DB ID |
| `panelState` | `DatabasePanelState` | 필터·정렬·그룹·컬럼 순서 설정 |
| `setPanelState` | `(p: Partial<DatabasePanelState>) => void` | 패널 상태 업데이트 콜백 |
| `visibleRowLimit` | `number?` | 최대 표시 행 수 |

## 내부 타입
| 타입 | 설명 |
|------|------|
| `FillDragState` | `{ columnId, sourceRowIndex, sourceValue }` — 셀 값 복사 드래그 상태 |

## 주요 내부 컴포넌트
| 컴포넌트 | 설명 |
|---------|------|
| `DatabaseTableRow` (memo) | 단일 행 렌더. row/isBoxSelected + 자신이 관여하는 fill 정보(범위 경계·소스 행 여부) 변경 시에만 리렌더 |

## 렌더 성능 패턴 (회귀 방지 — 1000행 타이핑 렉)

Phase 1 리팩토링으로 1000행 타이핑/드래그 시 전 행 리렌더를 차단했다. behavior-preserving(출력·갱신 시점 동일). 아래 가드를 깨면 렉이 재발한다.

### 1. `s.pages` 전량 구독 차단 + 트리 인덱스 1회 파생
- 과거: `DatabaseTableView`와 각 `DatabaseTableRow`가 `usePageStore((s) => s.pages)` 를 구독하고, 행마다 `countPageDescendants(row.pageId, pages)`(트리 재구축·정렬)를 호출 → 임의 페이지 변경이 전 행 리렌더 + O(n) 비용.
- 현재: **페이지 트리가 켜진 경우에만**(`panelState.pageTreeEnabled === true`) `usePageStore(useShallow(...))` 로 "직접 자식 보유 부모 ID" 집합(`parentIdsWithChildren: Set`)을 1회 파생. 트리 미사용 뷰는 고정 빈 Set(`EMPTY_PARENT_SET`)을 반환해 `pages` 변경에 리렌더하지 않는다.
- 각 행은 `parentIdsWithChildren.has(row.pageId)` 로 `hasChildren` 를 O(1) 판정. `countPageDescendants` 호출 제거.
- `DatabaseTableRow` 내부의 단발 효과(focusRequest 트리 펼침)는 `pages` 구독 대신 `usePageStore.getState().pages` 로 즉시 조회한다.

### 2. fill-drag 상태 행별 격리
- 과거: `fillDrag`/`fillHoverRowIndex`/`fillApplying` 전체를 모든 행에 통째로 전파 → 드래그 중 모든 행 리렌더.
- 현재: `DatabaseTableView` 에서 범위(`fillRangeStart`/`fillRangeEnd`)·소스 컬럼·소스/적용 행 인덱스를 1회 파생하고, 각 행에는 **자신이 관여하는 정보만** 좁혀 전달한다. 범위 밖 행은 `null` 경계를 받아 memo 가 리렌더를 건너뛴다. `rIdx` 는 그룹/평면 공통 `effectiveRows` 기준 평면 인덱스(일관성).

### 3. 셀 memo
- `DatabaseCell`/`DatabaseCellDisplay` 의 store 조건부 구독·memo 패턴은 [cells.md](cells.md) 참조. 한 셀 편집이 같은 행/뷰 전체 셀로 번지지 않게 한다.

> 깨면 안 되는 불변식: (a) `pages` 무조건 전량 구독 금지, (b) 행 루프 안에서 `pages` 전체 순회 금지(1회 파생 Set 사용), (c) fill 상태 전 행 통짜 전파 금지, (d) `DatabaseTableRow`/`DatabaseCell(Display)` memo 유지 + 핸들러 안정화.

## 주요 렌더 요소
- 열 헤더: `DatabaseColumnHeader` (각 컬럼 타입별 아이콘·이름·정렬 메뉴)
- 셀: `DatabaseCell` (컬럼 타입별 인라인 에디터)
- 열 추가: `DatabaseAddColumnButton`
- 아이콘 선택: `IconPicker`
- 행 삭제 확인: `SimpleConfirmDialog`

## 행 선택
`useTableRowSelection` 훅으로 체크박스 + Shift 클릭 범위 선택 관리.

## fill-drag (셀 값 복사)
`FillDragState`로 드래그 시작 행·컬럼·값을 추적. 드래그 범위 행에 파란 점선 테두리 표시 후 mouseup 시 `cloneCellValue`로 대상 행들에 일괄 적용.

## 열 가시성·순서
`getVisibleOrderedColumns`, `moveVisibleColumnInViewConfig`, `setColumnVisibleInViewConfig`로 panelState 내 컬럼 순서·숨기기 상태 반영.

## 의존 관계
- **사용하는 스토어**: `useDatabaseStore`, `usePageStore`, `useUiStore`, `useHistoryStore`
- **사용하는 훅**: `useProcessedRows`, `useTableRowSelection`, `useWindowedRows`
- **사용하는 유틸**: `cellToSearchString`, `resolveActiveFilterRules` (`src/lib/databaseQuery`)
- **이 컴포넌트를 사용하는 곳**: `DatabaseBlockView.tsx` (view === "table" 분기, lazy)

## 주의사항
- `DatabaseTableRow`는 `memo`로 감싸져 있어 row·isBoxSelected 변경 시에만 리렌더한다. 핸들러 props를 `useCallback` 없이 인라인으로 넘기면 memo가 무력화되므로 주의.
- fill-drag의 `cloneCellValue`는 `structuredClone`을 시도하고 실패 시 원본 참조를 반환한다. 객체 타입 셀값(select 배열 등)은 복사본을 항상 사용해야 한다.
- `defaultMinWidthForType`으로 컬럼 타입별 최소 너비가 자동 지정된다. 이 함수는 이제 `COLUMN_TYPE_META[type].minWidth`(`src/types/database.ts`)를 읽으므로, 새 컬럼 타입 추가 시 `COLUMN_TYPE_META` 한 곳만 채우면 된다(`Record<ColumnType,_>` 라 누락은 컴파일 에러).
