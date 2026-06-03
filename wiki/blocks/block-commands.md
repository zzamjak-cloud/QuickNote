# 블록 조작 커맨드 유틸

블록 단위 이동·삭제·삽입·드래그를 처리하는 유틸 모음.

---

## moveBlock.ts — 블록 이동 Extension

`src/lib/tiptapExtensions/moveBlock.ts`

### 역할

커서 위치 기준으로 블록을 위/아래로 한 칸 이동하거나, 박스 선택 범위를 확장한다.

### Extension 이름

`moveBlock`

### 단축키

| 단축키 | 동작 |
|--------|------|
| `Mod-Alt-ArrowUp` | 현재 블록 위로 이동 |
| `Mod-Alt-ArrowDown` | 현재 블록 아래로 이동 |
| `Mod-Shift-ArrowUp` | 현재 블록 위로 이동 (대체 바인딩) |
| `Mod-Shift-ArrowDown` | 현재 블록 아래로 이동 (대체 바인딩) |
| `Shift-ArrowDown` | 박스 선택 범위 아래로 확장 |
| `Shift-ArrowUp` | 박스 선택 범위 위로 확장 |

### 주요 함수

- `moveBlock(editor, dir)` — 커서 기준으로 형제 블록과 자리를 바꾼다. doc 직속·콜아웃·토글 본문·탭 패널·컬럼·목록 등 동일 부모 형제를 모두 지원.
- `findBlockMoveContext(state)` — 커서 깊이에서 위로 올라가며 형제 재정렬이 가능한 첫 번째 컨테이너와 인덱스를 반환.
- `parentAllowsSiblingReorder(parent, child)` — 토글 헤더, toggleContent, columnLayout/column, tabBlock/tabPanel, table 셀 등은 재정렬 금지.
- `extendBlockSelection(editor, dir)` — `Shift-Arrow` 로 블록 단위 다중 선택 범위를 확장. depth가 1인 최상위 블록에서만 동작. codeBlock 내부에서는 비활성.
- `selectionPosAfterSwap(tr, parentPos, newChildren, targetIndex)` — 이동 후 커서를 새 위치로 조정.
- `firstInlinePosInside(node, blockStart)` / `lastInlinePosInside(node, blockStart)` — 블록 내 가장 깊은 inline content의 첫/마지막 위치 계산.

### 의존관계

- `topLevelBlockStartEndingAt` (`src/lib/pm/topLevelBlocks`)
- `reportNonFatal` (`src/lib/reportNonFatal`)

---

## deleteCurrentBlock.ts — 블록 삭제 Extension

`src/lib/tiptapExtensions/deleteCurrentBlock.ts`

### 역할

커서가 있는 블록 전체를 삭제하는 키보드 단축키를 제공한다.

### Extension 이름

`deleteCurrentBlock`, priority: 1000

### 단축키

| 단축키 | 동작 |
|--------|------|
| `Mod-Backspace` | 현재 블록 삭제 |
| `Mod-Delete` | 현재 블록 삭제 |

### 동작 규칙

- 선택 범위가 비어있을 때만 작동 (`selection.empty === true`).
- `DIRECT_PARENT_TYPES` (`doc`, `column`, `tabPanel`) 안의 블록만 삭제. tabPanel 내부 블록 삭제 시 tabBlock 통째 삭제되는 것을 방지.
- `PROTECTED_TYPES` (`columnLayout`, `column`) 은 삭제 불가.
- `LIST_ITEM_TYPES` (`listItem`, `taskItem`) 은 리스트 아이템 단위로 삭제.
- 블록 삭제 후 인접 블록으로 커서를 이동한다.

### 주요 함수

- `deleteCurrentBlock(editor)` — 삭제 타겟을 찾아 transaction 실행.
- `findDeleteTarget(state)` — 커서 위치에서 삭제 가능한 블록의 `{ from, to }` 범위 반환.

---

## insertBeforeBlock.ts — 블록 앞 삽입 Extension

`src/lib/tiptapExtensions/insertBeforeBlock.ts`

### 역할

현재 블록 바로 앞에 빈 paragraph를 삽입한다.

### Extension 이름

`insertBeforeBlock`

### 단축키

`Alt+Enter` — 현재 커서가 있는 doc 최상위 블록의 위에 빈 paragraph 삽입 후 커서 이동.

### 특이사항

- ProseMirror 플러그인(`Plugin`)으로 구현 — macOS IME(한자 변환) 이벤트보다 먼저 `preventDefault` 처리.
- 박스 드래그 선택 중에도 동작: 선택된 블록 중 가장 앞 블록 기준.
- `syncInsertBeforeBlockSelection(editor, boxSelectedStarts)` — 박스 선택 상태를 extension storage에 동기화하는 함수. 박스 선택 컴포넌트에서 호출.

### storage

`boxSelectedStarts: number[]` — 현재 박스 선택된 블록들의 ProseMirror 위치 배열.

---

## startBlockNativeDrag.ts — 네이티브 드래그 시작 유틸

`src/lib/startBlockNativeDrag.ts`

### 역할

그립 버튼 드래그 시 HTML5 DnD API + ProseMirror `view.dragging`을 연동해 블록 이동 드래그를 시작한다.

### 상수

`QUICKNOTE_BLOCK_DRAG_MIME = "application/x-quicknote-block-starts"` — 드래그 데이터 MIME 타입. drop 핸들러에서 이 값으로 QuickNote 블록 드래그인지 판별.

### 주요 함수

#### `startBlockNativeDrag(editor, event, blockStart, node)`

단일 블록 드래그 시작.
1. `NodeSelection`으로 블록 선택.
2. `Slice`로 드래그 데이터 준비.
3. `cloneElement`로 드래그 프리뷰 이미지 생성 (CSS 인라인 복사).
4. `event.dataTransfer.setDragImage`로 프리뷰 설정.
5. `QUICKNOTE_BLOCK_DRAG_MIME`에 `[blockStart]` JSON 저장.
6. `view.dragging` 설정.
7. `drop`/`dragend` 이벤트에서 프리뷰 DOM 정리.

#### `startContiguousBlocksNativeDrag(editor, event, chain)`

연속 선택된 여러 블록을 `NodeRangeSelection`으로 묶어 드래그. 각 블록의 DOM 클론을 세로로 쌓아 프리뷰 구성.

#### `startGripNativeDrag(editor, event, blockStart, node, boxSelectedStarts?)`

그립 버튼에서 호출되는 진입점. 박스 선택이 현재 블록을 포함하면 `startContiguousBlocksNativeDrag`, 아니면 `startBlockNativeDrag` 로 분기.

### 내부 헬퍼

- `cloneElement(node)` — DOM 노드를 computed style 인라인으로 복사해 클론 생성 (드래그 프리뷰용).
- `getDraggedBlockElement(view, pos)` — databaseBlock은 `.qn-database-block` wrapper 기준, 나머지는 `view.nodeDOM` 기준으로 드래그 대상 Element 반환.
- `getCSSText(element)` — computed style을 인라인 cssText 문자열로 변환.

### 의존관계

- `@tiptap/extension-node-range` (`NodeRangeSelection`)
- `QUICKNOTE_BLOCK_DRAG_MIME` 상수는 drop 핸들러에서도 참조됨

---

## blockSiblingMove.ts — 형제 블록 위치 교환 유틸

`src/lib/blockSiblingMove.ts`

### 역할

블록 핸들 드래그 외의 경로(예: 컨텍스트 메뉴 위/아래 이동)에서 블록을 형제와 교환한다. `moveBlock.ts`의 Extension 방식과 달리 외부에서 `blockStart`와 `blockDepth`를 직접 전달한다.

### exports

#### `moveAdjacentSiblingBlock(editor, blockStart, blockDepth, dir)`

- `blockStart` — ProseMirror 블록 시작 위치.
- `blockDepth` — 블록 깊이 (1 = doc 직속).
- `dir` — `"up"` 또는 `"down"`.

동작:
1. `blockStart + 1`을 resolve해 부모 컨테이너와 인덱스 파악.
2. `dir`에 따라 교환할 형제 인덱스 계산.
3. `parent.copy(Fragment.from(children))` 으로 새 부모 노드 생성 (불변).
4. `tr.replaceWith`로 교환, `tr.mapping`으로 이동 후 커서 위치 복원.
5. `scrollIntoView`로 화면 스크롤.

컬럼 내부 문단 등 중첩 블록에서도 동작.
