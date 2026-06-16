# 데이터베이스 개요

## 관련 파일

| 파일 | 역할 |
|------|------|
| `src/store/databaseStore.ts` | 행·열·뷰 상태 |
| `src/store/databaseViewPrefsStore.ts` | 필터·정렬·패널 상태 |
| `src/store/databaseRowIndexStore.ts` | DB별 row index snapshot + 로컬 캐시 |
| `src/components/database/DatabaseBlockView.tsx` | DB 블록 진입점 (뷰 렌더는 레지스트리 조회) |
| `src/components/database/databaseViewRegistry.ts` | 뷰 단일 등록점: ViewKind별 icon/label/component/isAvailable |
| `src/components/database/columnTypeIcons.ts` | 컬럼 타입 아이콘 + 한국어 라벨(`COLUMN_TYPE_LABELS`/`columnTypeLabel`) 단일 출처 |
| `src/types/database.ts` | `COLUMN_TYPE_META`: 컬럼 타입별 정책(minWidth/groupable/arrayValued/idLabelBacked) 단일 출처 |
| `src/components/database/views/DatabaseTableView.tsx` | 테이블 뷰 |
| `src/components/database/DatabaseTimelineView.tsx` | 타임라인 뷰 |
| `src/components/database/useOpenDatabaseRow.ts` | cached-only row 클릭 시 본문 로드 보장 |
| `src/components/layout/DatabaseManagerDialog.tsx` | DB 관리 팝업(목록·열기·삭제된 DB 휴지통·숨겨진 일괄삭제) |
| `src/lib/database/` | 스키마·셀 로직·필터 쿼리 |
| `infra/lambda/template-automation/` | DB 템플릿 자동 생성 runner |

## 데이터 구조
```
Database
├── columns: Column[]   (열 정의: 타입, 이름, 옵션)
├── rows: Row[]         (데이터 행)
└── views: View[]       (뷰 설정: 필터, 정렬, 표시 열)
```

## 뷰 종류
- **테이블 뷰** — 스프레드시트 형태
- **타임라인 뷰** — Gantt 형태, 날짜 열 기반
- (추가 뷰는 [views.md](views.md) 참조)

## 셀 타입
Text, Number, Select, MultiSelect, Status, Date, Checkbox, Person, File, URL/Phone/Email, DB Link, Page Link, Progress, Item Fetch 등 → [cells.md](cells.md)

## DB 관리 팝업 — 숨겨진 일괄삭제 단축 (테스트용)

`DatabaseManagerDialog` 에 빠른 테스트를 위한 숨겨진 기능이 있다(일반 사용자에게 노출 안 됨):

1. 제목 왼쪽 **DB 아이콘 더블클릭** → "DB 관리를 위한 체크박스를 활성화하시겠습니까?" 확인 팝업 → "활성화".
2. 활성 DB 리스트에 체크박스 노출 + 제목바 우측 **"N개 모두 삭제"** 버튼 활성화(0개면 비활성).
3. 체크 후 버튼 → "N개의 DB를 모두 삭제하시겠습니까?" → "모두 삭제" → 선택 DB 를 `deleteDatabase`(휴지통 이동, 복원 가능)로 일괄 삭제.

- 보호 DB(작업·마일스톤·피처, `고정` 배지)는 체크박스 미노출 + `deleteDatabase` 가 store 에서 자동 제외.
- 다이얼로그를 닫으면 체크박스 모드·선택 상태가 초기화된다.

## 단일 레지스트리 (새 ViewKind/ColumnType 추가 지점)

리팩토링으로 산재하던 메타가 단일 출처로 통합됐다. 모두 behavior-preserving(메타 테이블만 단일화, 셀/뷰 렌더 분기는 그대로).

| 추가/변경 대상 | 수정할 단 한 곳 | 참고 |
|------|------|------|
| 새 뷰(ViewKind) | `databaseViewRegistry.ts` 의 `DATABASE_VIEW_REGISTRY` (`:41`) | icon/label/component/isAvailable. 렌더·툴바·상수 자동 파생 |
| 컬럼 타입 한국어 라벨 | `columnTypeIcons.ts` 의 `COLUMN_TYPE_LABELS` (`:27`) | AddColumn/ColumnMenu/PropertyPanel 3곳이 파생 |
| 컬럼 타입 아이콘 | `columnTypeIcons.ts` 의 `COLUMN_TYPE_LUCIDE` (`:5`) → `defaultColumnIcon` | |
| 컬럼 정책(minWidth/groupable/arrayValued/idLabelBacked) | `types/database.ts` 의 `COLUMN_TYPE_META` (`:51`) | 4개 산재 정책 통합. 새 타입 누락을 컴파일러가 강제 검출 |

**단, 셀 렌더 분기는 단일화 대상이 아니다.** `renderCell`/`renderDisplay`(`DatabaseCell`/`DatabaseCellDisplay`)의 타입별 JSX 분기 흡수는 **미이행 결정**이다. 메타 레지스트리(라벨/아이콘/정책)만 단일화됐고, 셀 렌더는 여전히 컴포넌트 내부 case 분기를 유지한다. 새 셀 타입 추가 시 [cells.md](cells.md) 의 절차(컴포넌트 + 렌더 분기)는 그대로 따른다.

## 성능 회귀 방지 (1000행 타이핑 렉)

테이블/리스트 렌더 성능 패턴([DatabaseTableView.md](DatabaseTableView.md))을 깨면 **1000행에서 셀 타이핑 시 전 행 리렌더로 렉이 재발**한다. 핵심 가드:

- 뷰/셀 컴포넌트는 `s.pages` 전량을 무조건 구독하지 않는다. 트리/파생이 필요할 때만 조건부 구독하고, 미사용 시 selector 가 고정 빈 값을 반환하게 한다.
- `pages` 전량 순회(예: 행마다 후손 수 계산)는 1회 파생 인덱스(Set)로 바꿔 행 단위 O(1) 조회한다.
- 셀/표시 컴포넌트는 `memo` 유지, 핸들러 props 안정화.

## 관련 위키
- [views.md](views.md)
- [cells.md](cells.md)
- [filters-sort.md](filters-sort.md)
- [row-index-cache.md](row-index-cache.md)
- [template-automation.md](template-automation.md)
