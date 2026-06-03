# 블록 핸들 컴포넌트

`src/components/editor/blockHandles/`

## 파일 구성

blockHandles 디렉토리에는 현재 `helpers.ts` 단일 파일이 존재한다. 핸들 UI 렌더링 컴포넌트(`BlockHandles.tsx`)는 상위 `editor/` 디렉토리에 위치하며, helpers.ts는 그 컴포넌트에서 분리된 순수 헬퍼 모음이다.

---

## helpers.ts

`src/components/editor/blockHandles/helpers.ts`

### 역할

블록 핸들의 좌표 계산, 호버 판별, 타입 메뉴 항목 정의를 담당하는 순수 함수·상수·타입 모음. DOM 조작이나 React state를 포함하지 않는다. `BlockHandles.tsx`에서 분리되었으며 동작 변경 없음.

### 주요 타입

#### `HoverInfo`

```
{
  blockStart: number   // ProseMirror 블록 시작 위치
  node: PMNode         // 해당 ProseMirror 노드
  depth: number        // 노드 깊이
  rect: DOMRect        // 블록 DOM 요소의 bounding rect
}
```

### 주요 상수

| 상수 | 설명 |
|------|------|
| `GRIP_SIZE_PX` | 그립 버튼 크기(px) |
| `GRIP_ZONE_PAD_PX` | 그립 감지 영역 패딩 |
| `GUTTER_LEFT_PX` | 에디터 왼쪽 거터 너비 |
| `RECT_PAD_X` | 핸들 rect 계산 시 좌우 패딩 |
| `HANDLE_TOP_OFFSET_PX` | 핸들 상단 오프셋 |
| `LIST_ITEM_HANDLE_EXTRA_LEFT_PX` | listItem 핸들의 추가 왼쪽 오프셋 |
| `MIN_HANDLE_LEFT` | 핸들 최소 left 위치 |

### 주요 함수

#### `hoverFromResolvedPos(editor, $pos)`

`ResolvedPos` 기준으로 해당 위치의 블록 정보(`HoverInfo`)를 반환. `shouldSuppressBlockHandle`을 통해 억제 대상 노드는 건너뜀.

#### `getBestHoverInfo(editor, clientX, clientY)`

마우스 좌표 기준으로 가장 적합한 블록 핸들 대상을 반환하는 핵심 함수.

동작 순서:
1. `document.elementsFromPoint`로 마우스 아래 Element 스택 수집.
2. `collectListSuppressedOwnerStarts` — list 컨테이너가 같은 영역을 덮을 때 하위 listItem 핸들 억제 목록 수집.
3. `considerDatabaseBlockFromStack` — DB 블록 특수 처리.
4. `considerTableHandleFromStack` — 표 블록 특수 처리.
5. `considerContainerHandleFromStack` — 컨테이너 블록(callout, toggle 등) 처리.
6. Element 스택에서 `posAtDOM`으로 ProseMirror 위치 계산 후 `considerPosition` 호출.
7. 깊이가 가장 깊은 HoverInfo를 최종 반환.

**특수 규칙**:
- `listItem`/`taskItem`: 해당 행 내부에 마우스가 있을 때만 핸들 표시 (`pointInsideListOwnRow`).
- 컨테이너 블록(`table`, `columnLayout`, `tabBlock`, `callout`, `toggle`, `blockquote`): 좌상단 40px(table은 28px) 영역 호버 시에만 핸들 표시 — 내부 gap 통과 시 핸들 깜빡임 방지.
- databaseBlock: `.qn-database-block` wrapper rect 내부에 마우스가 있으면 다른 블록보다 우선.

#### `isListHandleNodeType(nodeType)`

listItem 또는 taskItem 여부 반환.

#### `pointInsideListOwnRow(editor, hover, clientX, clientY)`

listItem의 자체 행(내부 중첩 리스트 제외) 안에 마우스가 있는지 판별.

#### `visualElementForBlockNode(editor, blockStart, node)`

블록의 시각적 DOM 요소 반환. databaseBlock은 `.qn-database-block`, 나머지는 `view.nodeDOM` 기준.

### 타입 메뉴 상수

#### `TYPE_MENU_ITEMS`

블록 핸들의 "타입 변경" 드롭다운 항목 배열. 각 항목은 `{ label, icon, cmd }` 형태.

포함 타입: 본문, 제목 1/2/3, 글머리 목록, 번호 목록, 할 일, 인용, 코드 블록, 토글, 콜아웃.

#### `TOGGLE_VARIANT_MENU_ITEMS`

토글 변형 선택 항목: 일반 토글, 제목 1/2/3 토글.

---

## 블록 핸들 UI 구조

블록 핸들은 에디터 좌측 거터에 표시되며 마우스 호버 시 나타난다.

```
[그립 버튼]  [타입 변경 아이콘]
    │                │
    │                └─ 클릭: TYPE_MENU_ITEMS 드롭다운
    └─ 드래그: startGripNativeDrag() 호출
               클릭: 컨텍스트 메뉴 (복사, 삭제, 배경색, 위/아래 이동 등)
```

### 핵심 흐름

1. `mousemove` 이벤트 → `getBestHoverInfo(editor, clientX, clientY)` 호출.
2. 반환된 `HoverInfo`의 `rect`와 `blockStart`를 기반으로 핸들 위치 계산.
3. 그립 드래그 → `startGripNativeDrag(editor, event, blockStart, node, boxSelectedStarts)`.
4. 타입 변경 → `TYPE_MENU_ITEMS`의 `cmd(editor)` 실행.
5. `shouldFlattenWrapperBeforeTypeChange(nodeType)`가 true이면 타입 변경 전 wrapper flatten 처리.

### 의존관계

- `uiPolicy.ts` — `shouldSuppressBlockHandle`, `shouldUseDatabaseBlockChrome`, `shouldFlattenWrapperBeforeTypeChange`
- `startBlockNativeDrag.ts` — `startGripNativeDrag`
- `blockSiblingMove.ts` — 컨텍스트 메뉴의 위/아래 이동
