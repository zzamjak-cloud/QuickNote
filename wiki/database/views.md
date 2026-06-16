# 데이터베이스 뷰

## 파일 위치
- `src/components/database/views/DatabaseTableView.tsx`
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

## 갤러리 뷰
- 카드 커버는 선택된 file/url 컬럼을 우선하되, 커버 URL 로드 실패·비이미지 file·컬럼 미지정 상태에서는 항목 페이지 본문 첫 이미지를 fallback으로 쓴다.
- 커버 선택기는 항목 페이지 본문 이미지를 후보로 쓰며, `quicknote-image://`/`quicknote-file://` ref는 `useImageUrl`로 표시 URL을 풀어 썸네일을 렌더한다.

## 카드 memo (리스트/갤러리/칸반 — 성능 회귀 방지)

리스트/갤러리/칸반 뷰의 행/카드(`DatabaseListRow`/`GalleryCard`/칸반 카드)는 `memo` 로 감싸고, 카드에 넘기는 핸들러는 `pageId` 를 인자로 받는 안정 콜백(`useCallback`)으로 만든다. 인라인 클로저를 매 렌더 새로 만들면 memo 가 무력화돼 한 셀 편집이 전 카드 리렌더로 번진다(1000행 렉 재발). 훅은 early-return 위에 배치(조건부 호출 금지). behavior-preserving.

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

## 뷰 단일 레지스트리

뷰별 `icon`/`label`/`component`(lazy)/`isAvailable`은 `src/components/database/databaseViewRegistry.ts` 의 `DATABASE_VIEW_REGISTRY` (`databaseViewRegistry.ts:41`) 한 곳에서 선언한다. 키 순서가 토글/메뉴 노출 순서다(표·리스트·칸반·타임라인·갤러리). `DATABASE_VIEW_ORDER` (`:59`)는 그 키 배열.

- **렌더 진입점**: `DatabaseBlockView.tsx` 의 `activeViewComponent`는 과거 `switch(view)` 하드코딩이었으나, 이제 `DATABASE_VIEW_REGISTRY[view].component` 를 조회해 렌더한다(behavior-preserving).
- **상수 파생**: `databaseBlockViewConstants.ts` 의 `VIEW_ICONS`/`VIEW_LABELS`/`getUnavailableViewKinds`는 모두 레지스트리에서 파생한다(`DATABASE_VIEW_ORDER.map`/`.filter`). 더 이상 자체 하드코딩 테이블이 아니다.
- **가용성**: 칸반은 `select` 컬럼, 타임라인은 `date` 컬럼이 있을 때만 `isAvailable=true`. `getUnavailableViewKinds`는 `!isAvailable` 인 뷰를 반환.

### 새 뷰 추가 시 (단 한 곳)
`DATABASE_VIEW_REGISTRY` 에 `ViewKind` 항목 1개를 추가하면 렌더(`DatabaseBlockView`)·토글/메뉴(`DatabaseToolbarControls`)·상수가 함께 따라온다. `DatabaseBlockView` switch 수정은 더 이상 필요 없다(레지스트리에 없는 `view`는 `null` 렌더).
