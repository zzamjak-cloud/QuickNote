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

## 관련 위키
- [views.md](views.md)
- [cells.md](cells.md)
- [filters-sort.md](filters-sort.md)
- [row-index-cache.md](row-index-cache.md)
- [template-automation.md](template-automation.md)
