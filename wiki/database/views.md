# 데이터베이스 뷰

## 파일 위치
- `src/components/database/DatabaseTableView.tsx`
- `src/components/database/views/DatabaseListView.tsx`
- `src/components/database/DatabaseTimelineView.tsx`
- `src/components/database/DatabaseBlockView.tsx` — 뷰 전환 진입점

## 테이블 뷰
- 행/열 기반 스프레드시트
- 열 헤더 클릭 → 정렬
- 행 클릭 → 상세 패널 열림
- `panelState.pageTreeEnabled === true`일 때만 제목 셀의 하위 페이지 접기/펼치기 버튼과 하위 페이지 추가 버튼을 표시한다.

## 리스트 뷰
- 항목 중심의 세로 리스트
- `panelState.pageTreeEnabled === true`일 때만 항목의 하위 페이지 접기/펼치기 버튼과 하위 페이지 추가 버튼을 표시한다.
- 하위 페이지 트리 본문은 `DatabasePageSubtree`가 렌더한다. 펼쳐진 하위 페이지는 루트 항목보다 추가 들여쓰기(`BASE_INDENT_PX`)를 갖고, compact 모드에서도 `text-sm` 기준으로 표시한다.

## 타임라인 뷰
- 날짜 범위 열(Date 타입 2개: 시작일·종료일) 기반 Gantt
- 주요 파일: `src/components/database/views/DatabaseTimelineView.tsx`
- 날짜 미지정 행 → "Unscheduled" 섹션 표시
- 스크롤 시 아이템 컬럼과 타임라인 컬럼이 독립적으로 가로 스크롤

### 타임라인 회귀 주의
- Unscheduled 카드가 안 보이는 버그 이력 있음
- 아이템 컬럼 뒤로 숨는 z-index 이슈 이력 있음

## 뷰 전환
`databaseViewPrefsStore` 의 `activeView` 로 관리.
새 뷰 추가 시 `DatabaseBlockView.tsx` 의 뷰 렌더 분기에 추가.
