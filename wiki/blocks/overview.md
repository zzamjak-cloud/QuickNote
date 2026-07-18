# 블록 시스템 개요

## 블록 타입 목록

| id | 제목 | 그룹 | 슬래시 메뉴 항목 |
|----|------|------|-----------------|
| `paragraph` | 본문 | text | 본문 |
| `heading` | 제목 | text | 제목 1, 제목 2, 제목 3 |
| `list` | 목록 | list | 글머리 기호 목록, 번호 목록, 할 일 |
| `codeBlock` | 코드 블록 | text | 코드 블록 |
| `blockquote` | 인용 | text | 인용 |
| `horizontalRule` | 구분선 | text | 구분선 |
| `image` | 이미지 | media | 이미지 |
| `file` | 파일 | media | (없음 — 드래그 업로드만) |
| `pageMention` | 페이지 링크 | text | 새 페이지, 페이지 링크 |
| `database` | DB | database | DB - 전체 페이지, DB - 인라인 |
| `flowchart` | 플로우차트 | media | 플로우차트 |
| `dropdownMenu` | 드롭다운 메뉴 | interactive | 드롭다운 메뉴 |
| `gallery` | 갤러리 | media | 갤러리 |
| `table` | 표 | database | 표 |
| `button` | 버튼 | interactive | 버튼 |
| `bookmark` | 북마크 | embed | (없음 — URL 붙여넣기로 생성) |
| `callout` | 콜아웃 | text | 콜아웃 |
| `toggle` | 토글 | text | 토글, 제목 토글 목록 1/2/3 |
| `columns` | 컬럼 | layout | 컬럼 |
| `tabs` | 탭 | layout | 탭 |
| `youtube` | 유튜브 임베드 | embed | 유튜브 임베드 |
| `emoji` | 이모지 | interactive | 이모지 |

## 블록 시스템 구조

```
src/lib/blocks/
  registry.ts        ← 블록 정의 전체 목록 + 조회 함수
  editorPolicy.ts    ← UniqueID 제외 목록, DB 전용 판별, fullPage 정규화
  dndPolicy.ts       ← 드롭 가능 컨테이너 판별
  uiPolicy.ts        ← 핸들 억제, flatten, DB 크롬, 파일/콜아웃 여부 판별

src/lib/tiptapExtensions/
  imageBlock.tsx     ← Image.extend (TipTap 이미지 확장)
  fileBlock.tsx      ← Node.create (파일/비디오/오디오 atom)
  tabBlock.tsx       ← Node.create (탭 레이아웃 atom+container)
  youtubeBlock.tsx   ← Youtube.extend (YouTube 임베드)
  bookmarkBlock.tsx  ← Node.create (URL 북마크 atom)
  buttonBlock.tsx    ← Node.create (인라인 버튼 atom)
  databaseBlock.ts   ← Node.create (DB 임베드 atom)
  flowchartBlock.tsx ← Node.create (공유 플로우차트 atom)
  sharedBlocks.tsx   ← Node.create (공유 드롭다운 메뉴·갤러리 atom)
  blockBackground.ts ← Extension.create (GlobalAttributes — 배경/텍스트 색)
  moveBlock.ts       ← Extension.create (키보드 블록 이동)
  deleteCurrentBlock.ts ← Extension.create (Mod+Backspace/Delete)
  insertBeforeBlock.ts  ← Extension.create (Alt+Enter)

src/lib/
  startBlockNativeDrag.ts ← HTML5 DnD 시작 유틸
  blockSiblingMove.ts     ← 형제 블록 위치 교환 유틸

src/components/editor/blockHandles/
  helpers.ts         ← 블록 핸들 좌표·타입 판별 순수 헬퍼
```

### 의존 관계

```
registry.ts
  ↑ (조회)
editorPolicy.ts  dndPolicy.ts  uiPolicy.ts
  ↑ (사용)
TipTap Extensions / React Components / DnD handlers
```

policy 파일들은 registry의 `BlockDefinition`을 읽어 판단 로직을 제공한다. TipTap 확장 자체에는 policy 로직이 포함되지 않는다.

## 새 블록 타입 추가 절차

1. **TipTap 확장 작성** — `src/lib/tiptapExtensions/` 에 `Node.create` 또는 기존 확장 `.extend` 로 작성.
   - `name`, `group`, `atom` 여부, `addAttributes`, `addNodeView` 구현.

2. **registry 등록** — `src/lib/blocks/registry.ts` 의 `blockDefinitions` 배열에 `defineBlock(...)` 항목 추가.
   - `id`, `title`, `nodeTypes`, `group`, `dnd` (movableLeafDnd 또는 containerDnd), `toolbar.kind`, `slashTitles` 지정.

3. **policy 확인** — 핸들을 숨겨야 하면 `uiPolicy.ts` 의 `HANDLE_SUPPRESSED_NODE_TYPES` 에 nodeType 추가. UniqueID에서 제외해야 하면 `editorPolicy.ts` 의 `UNIQUE_ID_EXCLUDED_NODE_TYPES` 에 추가.

4. **슬래시 메뉴 등록** — `src/lib/tiptapExtensions/slashMenu/menuEntries.ts` 에 항목 추가 (command.slashTitles 와 일치해야 함).

5. **에디터에 확장 등록** — TipTap 에디터 초기화(`useEditor`) 의 extensions 배열에 추가.
