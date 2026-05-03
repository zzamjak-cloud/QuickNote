# 노션형 데이터베이스 리팩토링 설계 (v1.1.3)

## 배경

[Plan/노션형_db_구현_822e4767.plan.md](../../../Plan/) 기반 1차 구현은 행을 별도 `databaseStore.rows`로 저장했지만, 결과적으로:

1. **행이 페이지가 아님** — 행을 "열어서" 본문 + 속성을 편집할 수 없음.
2. **속성 편집은 사이드바·셀 인라인뿐** — 노션의 "행 페이지 상단 속성 패널 + 하단 본문" 구조 부재.
3. **열 추가 UX가 사이드바 dropdown** — 노션은 헤더 우측 "+" 클릭 한 번으로 추가.
4. **열 드래그 재정렬 미구현**.

본 스펙은 위 4개를 한 번에 해결하는 **행 = 페이지 통합 리팩토링**을 정의한다.

## 결정 사항 (브레인스토밍 결과)

| 질문 | 결정 |
|------|------|
| 행 페이지 열기 방식 | (c) 전체 페이지 + 사이드 피크 둘 다, 기본은 전체 페이지 |
| title ↔ 페이지 제목 | (b) 페이지 제목만 사용 — title 컬럼은 별도 셀 값 없이 `page.title` 직결 |
| 트리에서 행 페이지 가시성 | (b) 숨김 (노션 기본) |
| 컬럼 "+" 위치 | (a) 표 헤더 맨 오른쪽 항상 표시 + 타입 선택 팝오버 |
| 열 드래그 핸들 | (b) 헤더 hover 시 grip 핸들 표시 |
| 기존 데이터 처리 | (b) wipe (v2 migrate에서 빈 객체 반환) |

## 데이터 모델

### `Page` 확장 (`src/types/page.ts`)

```ts
type Page = {
  id: string;
  title: string;
  icon: string | null;
  doc: JSONContent;
  parentId: string | null;
  order: number;
  createdAt: number;
  updatedAt: number;
  // 신규
  databaseId?: string;                       // 이 페이지가 DB 행이면 소속 DB id
  dbCells?: Record<string, CellValue>;       // title 컬럼 제외 모든 셀 값
};
```

### `DatabaseBundle` 정리 (`src/types/database.ts`)

```ts
type DatabaseBundle = {
  meta: DatabaseMeta;
  columns: ColumnDef[];
  rowPageOrder: string[];   // 행 페이지 id 순서
  // rows, rowOrder 제거
};
```

`DatabaseRow` 타입은 제거.

### title 컬럼 규약

- 시드 컬럼은 항상 `type: "title"` 1개를 첫 번째에 포함.
- title 컬럼의 셀 값은 항상 `page.title`을 읽고 쓴다 (`dbCells`에 저장 금지).
- title 컬럼은 삭제·타입 변경 불가.

## 저장소 전략

### `databaseStore.ts` 액션 변경

| 액션 | 동작 |
|------|------|
| `createDatabase(title?)` | 빈 DB 번들 생성. **시드 행 페이지 1개**도 함께 생성(`pageStore.createPage`로 만들고 `databaseId` 부여). |
| `addRow(databaseId)` → `string` | 내부적으로 `pageStore.createPage(...)`로 페이지 생성 후 `databaseId`/`dbCells={}` 설정. `rowPageOrder` 끝에 push. 새 페이지 id 반환. |
| `deleteRow(databaseId, pageId)` | `pageStore.deletePage(pageId)` 호출 + `rowPageOrder`에서 제거. |
| `updateCell(databaseId, pageId, columnId, value)` | columnId가 title 컬럼이면 `pageStore.renamePage(pageId, value as string)`, 아니면 `pageStore.setPageDbCell(pageId, columnId, value)` 호출. |
| `setRowOrder(databaseId, pageIds)` | `rowPageOrder` 교체. |
| `addColumn`, `updateColumn`, `removeColumn` | 기존 동작 유지. title 컬럼 삭제·타입 변경 가드. |
| `moveColumn(databaseId, fromIdx, toIdx)` (신규) | 컬럼 배열 순서 변경. |

### `pageStore.ts` 변경

신규 액션:
```ts
setPageDbCell: (pageId: string, columnId: string, value: CellValue) => void;
```

선택자 변경:
- `selectPageTree`, `filterPageTree`, `selectSortedPages`에서 `p.databaseId != null`인 페이지 자동 제외.
- 결과적으로 사이드바·검색에 행 페이지가 노출되지 않음.

### 마이그레이션 (wipe)

- `DATABASE_STORE_VERSION = 2`로 bump.
- `databaseStore` `migrate(persisted, version)`: 모든 이전 버전에 대해 `{ version: 2, databases: {} }` 반환.
- pageStore는 신규 필드(optional)뿐이라 마이그레이션 불필요. 기존 페이지에 행 페이지가 없었으므로 영향 없음.

## TipTap / 라우팅 통합

### 행 페이지 인식

- `App.tsx`의 메인 영역에서 `activePage.databaseId`가 있으면 `<DatabaseRowPage>` 렌더, 없으면 기존 `<Editor>` 렌더. (`Editor.tsx`는 일반 페이지 전용으로 유지.)

### 사이드 피크

- 전역 상태(예: `useUiStore` 또는 `pageStore`에 `peekPageId: string | null` 추가).
- `App.tsx`에서 `peekPageId`가 있으면 우측 슬라이드 모달로 `<DatabaseRowPeek pageId={peekPageId} />` 렌더.
- ESC, 바깥 클릭, "x" 버튼으로 닫음.

### 행 열기 트리거 매트릭스

| 조작 | 결과 |
|------|------|
| 타이틀 셀 텍스트 클릭 | 인라인 편집 (`page.title` 변경) |
| 행 hover ↗ "Open" 아이콘 | 전체 페이지 이동 (`setActivePage(pageId)`) |
| 행 hover ⤢ "Peek" 아이콘 | `setPeekPageId(pageId)` |
| 셀 사이 빈 영역 클릭 | 무동작 |

### `databaseBlock` TipTap 노드

- 현재 `attrs.databaseId`/`view`/`layout`/`panelState` 그대로.
- `panelState`는 행 정렬·필터·검색 상태를 블록별로 유지(현행과 동일).

## 컴포넌트 구조

### 신규

| 파일 | 역할 |
|------|------|
| `src/components/database/DatabaseColumnHeader.tsx` | 헤더 셀: hover 시 좌측 grip 핸들(드래그), 타입 아이콘, 인라인 이름 편집, 클릭 시 컬럼 메뉴(이름 변경, 타입 변경, 옵션 편집, 삭제). |
| `src/components/database/DatabaseAddColumnButton.tsx` | 헤더 우측 끝 "+" 셀. 팝오버에서 13개 컬럼 타입 선택 → `addColumn` 호출 후 자동으로 이름 인라인 편집 진입. |
| `src/components/database/DatabaseRowPage.tsx` | 전체 페이지 모드: 백버튼, 큰 제목 입력, `<DatabasePropertyPanel>`, TipTap 본문. |
| `src/components/database/DatabaseRowPeek.tsx` | 우측 슬라이드 모달: 위 컴포넌트와 동일 콘텐츠를 좁은 폭으로. ESC/바깥 클릭 닫힘. |
| `src/components/database/DatabasePropertyPanel.tsx` | 컬럼 N개를 한 줄씩 라벨+에디터로 배치. title 제외. `ColumnOptionsEditor`는 컬럼 메뉴에서 호출되므로 패널에는 미노출. |
| `src/components/database/DatabaseColumnMenu.tsx` | 헤더 클릭 메뉴: 이름 변경, 타입 변경, 옵션 편집(select류), 삭제. |
| `src/store/uiStore.ts` (또는 pageStore 확장) | `peekPageId` 상태. |

### 수정

| 파일 | 변경 |
|------|------|
| `src/types/page.ts` | `databaseId?`, `dbCells?` 추가. |
| `src/types/database.ts` | `DatabaseRow` 제거, `DatabaseBundle.rows`/`rowOrder` 제거 후 `rowPageOrder` 추가. |
| `src/store/databaseStore.ts` | 위 표대로 액션 재작성. v2 migrate. |
| `src/store/pageStore.ts` | `setPageDbCell` 추가, 트리/정렬 선택자에 행 페이지 필터. |
| `src/components/database/DatabaseBlockView.tsx` | 행 추가/삭제 액션이 페이지 기반으로 동작하도록 인터페이스만 정리. |
| `src/components/database/views/DatabaseTableView.tsx` | 헤더: `<DatabaseColumnHeader>` × N + `<DatabaseAddColumnButton>`. 행: hover grip + 타이틀 셀 인라인 편집 + ↗ "open" + ⤢ "peek" 아이콘. 컬럼 드래그 시 `moveColumn`, 행 드래그 시 `setRowOrder`. |
| `src/components/database/views/DatabaseKanbanView.tsx` 외 4종 | 카드 제목 = `page.title`. 카드 클릭 라우팅 규칙 적용. 카드 본문 미리보기는 선택적 표시. |
| `src/components/database/useProcessedRows.ts` | pageStore에서 `databaseId === id`인 페이지를 `rowPageOrder` 순서로 모아 반환. 검색은 `page.title` + `dbCells` 결합. |
| `src/components/database/DatabasePropertySidebar.tsx` | 컬럼 추가 dropdown UI 제거 (헤더 "+"가 담당). 컴포넌트 자체 삭제 가능. 호출처(`DatabaseBlockView`의 `propsOpen` 토글)도 함께 제거. |
| `src/components/editor/Editor.tsx` | `activePage.databaseId`가 있으면 본 에디터 대신 `<DatabaseRowPage>` 렌더 (또는 부모인 `App.tsx`에서 분기). |
| `src/App.tsx` | 메인 영역 분기 + peek 오버레이 mount. |
| `src/__tests__/databaseQuery.test.ts` | 신 모델 기준으로 갱신. `moveColumn`, `setPageDbCell` 테스트 추가. |

## 드래그 구현 (행 / 열 공통)

- HTML5 native drag (`draggable=true` + `onDragStart/Over/Drop`)로 처리. 기존 `src/lib/startBlockNativeDrag.ts` 패턴 참고.
- 핸들은 `lucide-react`의 `GripVertical`. 컬럼 헤더와 행 좌측에 hover 시 표시.
- 드롭 위치 표시: 표 행은 1px 가로 라인, 컬럼 헤더는 1px 세로 라인.
- 드래그 가능 영역은 핸들에서만 시작 (`draggable`은 핸들 요소에만 부여).

## 행 페이지 레이아웃 (RowPage / Peek 공통 콘텐츠)

```
┌──────────────────────────────────────────┐
│ ← 데이터베이스 이름                       │  ← 백버튼 (Peek은 ✕로 대체)
│                                           │
│  📄                                       │  ← 페이지 아이콘 (있으면)
│  큰 제목 입력 (page.title)                │
│                                           │
│  ─────────────────────────                │
│  📌 상태       │  옵션 셀렉터              │  ← 속성 패널
│  📅 마감       │  날짜 입력                │
│  👤 담당       │  사람 선택                │
│  ✚ 속성 추가                              │  ← 헤더 "+"와 동일 팝오버
│  ─────────────────────────                │
│                                           │
│  TipTap 본문 에디터…                      │
│                                           │
└──────────────────────────────────────────┘
```

## 테스트 계획

- `databaseStore.test`: `addRow`/`deleteRow`가 pageStore에 정상 반영, `updateCell` title 케이스가 `renamePage` 호출, `moveColumn` 정상 동작, v2 migrate가 빈 객체 반환.
- `useProcessedRows.test`: pageStore + databaseStore 조합으로 검색/필터/정렬 정상.
- `pageStore.test`: 행 페이지가 `selectPageTree`/`selectSortedPages`에서 제외.
- 수동 QA 시나리오:
  1. 슬래시 "DB → 표" 삽입 후 시드 행 1개 확인.
  2. 행 제목 셀 인라인 편집 → 사이드바 트리에 노출 안 되는지 확인.
  3. 행 ↗ 클릭 → 활성 페이지 전환 + 백버튼 작동.
  4. 행 ⤢ 클릭 → 우측 피크 모달 + ESC 닫힘.
  5. 헤더 "+" → 타입 선택 → 새 컬럼이 즉시 인라인 편집 진입.
  6. 컬럼 grip 드래그로 순서 변경.
  7. 행 grip 드래그로 순서 변경.
  8. title 컬럼 삭제 시도 → 차단됨.
  9. 칸반/갤러리/리스트/타임라인 뷰에서도 카드 제목이 `page.title`을 따라가는지.
  10. 같은 `databaseId`를 가진 다른 페이지의 `databaseBlock`도 동일 행 집합을 보는지 (소스 공유).

## 비범위 (이번 PR 제외)

- 인접 페이지 간 임베디드 미리보기 / 동기화된 다중 뷰 외부 노출.
- 칸반/갤러리/타임라인의 카드 본문 줄바꿈·이미지 썸네일 고도화 (제목·핵심 속성만 표시).
- 행 페이지 내 backlink 표기.
- 데이터베이스 템플릿 / 자동화.
