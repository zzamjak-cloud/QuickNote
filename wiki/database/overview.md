# 데이터베이스 개요

## 관련 파일

| 파일 | 역할 |
|------|------|
| `src/store/databaseStore.ts` | 행·열·뷰 상태 |
| `src/store/databaseViewPrefsStore.ts` | 필터·정렬·패널 상태 |
| `src/store/databaseRowIndexStore.ts` | DB별 row index snapshot + 로컬 캐시 |
| `src/components/database/DatabaseBlockView.tsx` | DB 블록 진입점 |
| `src/components/database/DatabaseTableView.tsx` | 테이블 뷰 |
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

## 관련 위키
- [views.md](views.md)
- [cells.md](cells.md)
- [filters-sort.md](filters-sort.md)
- [row-index-cache.md](row-index-cache.md)
- [template-automation.md](template-automation.md)
