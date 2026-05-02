# QuickNote v1.1.0 — 노션 격차 좁히기

## 목표
"마크다운 편집기" 인상에서 "노션" 인상으로 끌어올린다. 세 영역을 한 릴리즈에 묶는다.

## A. 페이지 트리 & 아이콘
- `parentId`/`order`를 활용한 사이드바 **재귀 트리 뷰**
- 페이지별 토글(접기/펼치기) 상태는 `settingsStore.expandedIds`로 보관
- 새 페이지 생성 시 부모 지정 (`+` 호버 시 하위 추가 버튼 노출)
- 페이지 본문 상단 **아이콘 슬롯** — 이모지 picker (간단한 grid + 네이티브 입력)
- 드래그로 부모 변경: 같은 부모 내 정렬 + 다른 부모로 이동 모두 지원

## B. 블록 호버 핸들 (⋮⋮ + ➕)
- ProseMirror 플러그인 `draggableBlock` 추가
  - 마우스 좌표를 `posAtCoords`로 매핑하여 현재 호버 중인 최상위 블록 위치 추적
  - 좌측 여백에 절대 위치 ⋮⋮ 핸들과 ➕ 버튼을 DOM `Decoration.widget`으로 렌더
  - ➕ 클릭: 다음 줄에 빈 paragraph 삽입 + 슬래시 메뉴 자동 호출
  - ⋮⋮ 드래그: HTML5 DnD로 노드 이동, 드롭 시 ProseMirror 트랜잭션으로 노드 절단·삽입

## C. 리치 콘텐츠 블록
- **테이블** (`@tiptap/extension-table` 등 4개)
- **컬러 & 하이라이트** (`@tiptap/extension-color`, `-highlight`, `-text-style`) — 부유 메뉴(`BubbleMenu`)에서 선택
- **콜아웃** — 커스텀 노드 (이모지 + 텍스트 컨테이너)
- **토글** — 커스텀 노드 (`<details>` 패턴, summary/content 분리)
- **인라인 페이지 링크** — `@tiptap/extension-mention` + 페이지 제목 suggestion
- **YouTube 임베드** — `@tiptap/extension-youtube`

## 영향 파일
- `src/store/pageStore.ts` — 트리 셀렉터, 부모 변경 액션
- `src/store/settingsStore.ts` — `expandedIds`, `darkMode`는 그대로
- `src/components/layout/Sidebar.tsx`, `PageListItem.tsx` — 재귀 트리, 들여쓰기, 토글
- `src/components/editor/Editor.tsx` — 새 확장 등록
- `src/components/editor/IconPicker.tsx` (신규)
- `src/components/editor/BlockHandles.tsx` (신규)
- `src/components/editor/BubbleToolbar.tsx` (신규)
- `src/lib/tiptapExtensions/draggableBlock.ts` (신규)
- `src/lib/tiptapExtensions/callout.ts` (신규)
- `src/lib/tiptapExtensions/toggle.ts` (신규)
- `src/lib/tiptapExtensions/pageMention.ts` (신규)
- `src/lib/tiptapExtensions/slashItems.ts` — 신규 항목 추가

## 검증
1. 페이지를 트리로 만들고(부모/자식) 토글·DnD 부모 변경.
2. 페이지 헤더에서 이모지 클릭 → grid에서 선택 → 사이드바에 반영.
3. 본문에서 호버 시 ⋮⋮ 노출 → 드래그로 다른 위치에 드롭.
4. ➕ 클릭 → 빈 줄 + 슬래시 메뉴.
5. `/table` → 3×3 표 삽입 → 셀 편집.
6. 텍스트 선택 → BubbleMenu에서 빨강/노랑 하이라이트.
7. `/callout`, `/toggle`, `/mention`, `/youtube` 동작.
8. `npm run lint && npm run test:run && npm run build` 모두 통과.
