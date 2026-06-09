# 데이터베이스 셀

## 파일 위치
- `src/components/database/cells/` — 셀 타입별 컴포넌트
- `src/lib/database/` — 셀 값 파싱·직렬화

## 셀 타입

| 타입 | 컴포넌트 | 비고 |
|------|---------|------|
| Text | TextCell | 단순 텍스트 |
| Number | NumberCell | 숫자 포맷 |
| Select | SelectCell / OptionCells | 단일 선택, 옵션 팝업, sourceFromDb 자동화 가능 |
| MultiSelect | MultiSelectCell | 복수 선택 |
| Status | SelectCell / OptionCells | 상태 선택 |
| Date | DateCell | 날짜 피커. 표시 형식은 2자리 연도(`YY. MM. DD`, 예: `26. 01. 01`) |
| Checkbox | CheckboxCell | true/false |
| Person | PersonCell | 멤버 선택 |
| File | FileCell | 파일 첨부 |
| URL / Phone / Email | TextCell 계열 | 링크·연락처 텍스트 |
| DB Link | DatabaseLinkCell | 다른 DB 행 연결 |
| Page Link | PageLinkCell | 직접 연결 또는 pageLinkMirror/sourceFromDb 기반 참조 표시 |
| Progress | ProgressCell | source DB 완료율 계산 |
| Item Fetch | ItemFetchCell | source DB에서 현재 행과 매칭되는 페이지 목록 표시 |

## 자동화/참조 셀
- `sourceFromDb` 자동화 결과가 비어 있으면 저장된 수동 셀값을 표시·편집 fallback 으로 사용한다. 참조 DB 값이 채워지면 자동화 값이 다시 우선한다.
- `Page Link`는 연결 값을 다른 셀로 복사하거나 역방향으로 쓰지 않는다. 연결 DB의 `연결 없음`은 특정 DB scope가 없는 상태이며, 연결 DB 목록에서는 현재 DB를 제외한다.
- `Page Link`의 참조 표시는 `pageLinkMirrorColumnId`, `sourceFromDb`, `itemFetch` 실효값으로 계산한다.
- `Progress`는 `progressSource`/`itemFetch` 기준 완료율 계산이며 pageLink 역방향 쓰기와 무관하다.
- `Item Fetch`는 source DB에서 현재 row와 매칭되는 페이지를 읽기 전용으로 표시하며, LC Feature의 작업 목록과 진행률 계산에 사용된다.

## 속성 타입 메뉴
- 컬럼 추가 메뉴, 컬럼 메뉴, 속성 패널의 타입 드롭다운은 타입명 왼쪽에 `defaultColumnIcon` 기반 아이콘을 표시한다.
- `JSON` 타입은 내부 파서/정규화 유틸은 유지하지만 타입 선택 목록에는 노출하지 않는다.

## 날짜 표시 형식 (2자리 연도)
날짜 표기는 `YY. MM. DD`(2자리 연도)로 통일한다. 포맷 함수가 **여러 곳에 분산**되어 있으므로 형식 변경 시 모두 함께 수정해야 한다(회귀 주의):
- `src/components/database/cells/utils.ts` `formatDate` — DateCell 등 셀 직접 표시
- `src/components/database/databaseCellDisplayUtils.ts` `formatYmdDisplay` — **리스트/카드 등 표시설정 뷰**의 날짜 텍스트
- `src/lib/tiptapExtensions/dateInline.ts` `formatDateLabel` — 에디터 인라인 날짜 노드

## 팝업 처리
- `OptionCells` 등은 `CellEditorBase` 프리미티브 사용 (`src/lib/ui-primitives/CellEditorBase.tsx`)
- 팝업 위치는 `useAnchoredPopover` 로 화면 경계 보정 → [ui/popup-clipping.md](../ui/popup-clipping.md)

## 셀 추가 시
1. `src/components/database/cells/` 에 컴포넌트 생성
2. `src/lib/database/` 에 타입 정의·실효값 해석 추가
3. 셀 렌더 분기(`DatabaseTableView` 또는 공용 셀 렌더러)에 타입 추가
