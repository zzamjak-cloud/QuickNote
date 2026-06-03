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
| `DatabaseTableRow` (memo) | 단일 행 렌더. row/isBoxSelected 변경 시에만 리렌더 |

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
- `defaultMinWidthForType`으로 컬럼 타입별 최소 너비가 자동 지정된다. 새 컬럼 타입 추가 시 이 함수도 업데이트 필요.
