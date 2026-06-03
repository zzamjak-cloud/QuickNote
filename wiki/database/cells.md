# 데이터베이스 셀

## 파일 위치
- `src/components/database/cells/` — 셀 타입별 컴포넌트
- `src/lib/database/` — 셀 값 파싱·직렬화

## 셀 타입

| 타입 | 컴포넌트 | 비고 |
|------|---------|------|
| Text | TextCell | 단순 텍스트 |
| Number | NumberCell | 숫자 포맷 |
| Select | SelectCell / OptionCells | 단일 선택, 옵션 팝업 |
| MultiSelect | MultiSelectCell | 복수 선택 |
| Date | DateCell | 날짜 피커 |
| Checkbox | CheckboxCell | true/false |
| Person | PersonCell | 멤버 선택 |
| Relation | RelationCell | 다른 DB 행 연결 |

## 팝업 처리
- `OptionCells` 등은 `CellEditorBase` 프리미티브 사용 (`src/lib/ui-primitives/CellEditorBase.tsx`)
- 팝업 위치는 `useAnchoredPopover` 로 화면 경계 보정 → [ui/popup-clipping.md](../ui/popup-clipping.md)

## 셀 추가 시
1. `src/components/database/cells/` 에 컴포넌트 생성
2. `src/lib/database/` 에 타입 정의 추가
3. 셀 렌더 분기(`DatabaseTableView` 또는 공용 셀 렌더러)에 타입 추가
