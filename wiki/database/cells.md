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
- **타입 한국어 라벨은 `columnTypeIcons.ts` 의 `COLUMN_TYPE_LABELS`(`columnTypeIcons.ts:27`) / `columnTypeLabel(type)` 단일 출처**다. `AddColumnButton`/`ColumnMenu`/`PropertyPanel` 3곳에 중복·드리프트되던 라벨 배열을 레지스트리 파생으로 통합했다(각 메뉴가 노출하는 타입 *목록*은 컨텍스트별로 그대로 유지 → behavior-preserving).
- `JSON` 타입은 내부 파서/정규화 유틸은 유지하지만 타입 선택 목록에는 노출하지 않는다.

## 날짜 표시 형식 (2자리 연도)
날짜 표기는 `YY. MM. DD`(2자리 연도)로 통일한다. 포맷 함수가 **여러 곳에 분산**되어 있으므로 형식 변경 시 모두 함께 수정해야 한다(회귀 주의):
- `src/components/database/cells/utils.ts` `formatDate` — DateCell 등 셀 직접 표시
- `src/components/database/databaseCellDisplayUtils.ts` `formatYmdDisplay` — **리스트/카드 등 표시설정 뷰**의 날짜 텍스트
- `src/lib/tiptapExtensions/dateInline.ts` `formatDateLabel` — 에디터 인라인 날짜 노드

## 팝업 처리
- `OptionCells` 등은 `CellEditorBase` 프리미티브 사용 (`src/lib/ui-primitives/CellEditorBase.tsx`)
- 팝업 위치는 `useAnchoredPopover` 로 화면 경계 보정 → [ui/popup-clipping.md](../ui/popup-clipping.md)

## 컬럼 타입 정책 메타 (단일 출처)
컬럼 타입별 정책 4종은 `src/types/database.ts` 의 `COLUMN_TYPE_META`(`Record<ColumnType, ColumnTypeMeta>`, `database.ts:51`) 한 곳에서 선언한다. `Record` 형태라 새 타입 추가 시 누락을 컴파일러가 강제 검출한다(과거 Set/배열은 런타임까지 통과).

| 필드 | 의미 | 소비처 |
|------|------|--------|
| `minWidth` | colgroup width/minWidth 기본값(px) | `defaultMinWidthForType` (`database.ts:395`) |
| `groupable` | 표/리스트/갤러리 그룹화 대상(칸반 제외) | `grouping.ts` 의 `GROUPABLE_COLUMN_TYPES`(메타에서 파생) |
| `arrayValued` | 다중 값(배열) 저장 타입(시드/필터가 배열 기대) | `databaseStore/helpers.ts` 의 `ARRAY_VALUED_COLUMN_TYPES`(메타에서 파생) |
| `idLabelBacked` | 값이 id, 라벨은 별도 해석(옵션/사람/링크류) | `filterValueLabels.ts` 의 `isIdLabelBackedColumn`(메타 참조) |

## 셀 메모 / 조건부 store 구독 (성능 — 회귀 방지)
`DatabaseCell`/`DatabaseCellDisplay` 는 한 셀 편집이 같은 행/뷰 전체 셀로 리렌더를 번지지 않도록 한다. behavior-preserving.

- **`DatabaseCell`**: 과거 `s.databases`/`s.pages` 를 무조건 구독해 무관한 행/DB 변경에도 리렌더됐다. 현재는 자동 derive(`config.sourceFromDb`) 또는 `pageLink` 타입일 때만(`needsCrossStore`) 두 store 를 구독하고, 그 외 타입은 selector 가 `null` 을 반환해 store 변화로 리렌더되지 않는다. 값은 전적으로 `value` prop 에서 온다(동작 동일).
- **`DatabaseCellDisplay`**: `memo` 로 감쌌다. `members` 는 person 타입 또는 sourceFromDb(person 해석 가능) 일 때만 구독하고, 그 외엔 고정 빈 배열(`EMPTY_MEMBERS`)을 반환해 멤버 변경 리렌더를 막는다.
- props(`column`/`value`/`rowId`/`textClassName`)는 불변 패턴으로 전달돼야 memo 가 유효하다.

## 셀 추가 시
1. `src/components/database/cells/` 에 컴포넌트 생성
2. `src/lib/database/` 에 타입 정의·실효값 해석 추가
3. 셀 렌더 분기(`DatabaseCell`/`DatabaseCellDisplay` 내부 case)에 타입 추가 — **렌더 분기는 단일 레지스트리로 흡수하지 않았다(미이행 결정)**. 메타(라벨/아이콘/정책)만 단일화됐고 타입별 JSX 는 컴포넌트 case 분기 유지.
4. `src/types/database.ts` 의 `COLUMN_TYPE_META` 에 새 타입 항목 추가(컴파일러가 누락 강제). 필요 시 `COLUMN_TYPE_LABELS`/`COLUMN_TYPE_LUCIDE`(`columnTypeIcons.ts`)도 추가.
