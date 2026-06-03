# registry.ts 상세

`src/lib/blocks/registry.ts`

## 역할

블록 시스템의 단일 진실 원천. 모든 블록 타입의 메타데이터를 `BlockDefinition` 배열로 관리하고, nodeType 기준 조회 함수를 제공한다.

## 핵심 타입

### BlockDefinition

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | string | 블록 고유 식별자 (예: `"image"`) |
| `title` | string | 사람이 읽는 이름 (예: `"이미지"`) |
| `nodeTypes` | string[] | 이 블록에 속하는 ProseMirror 노드 타입 이름들 |
| `group` | BlockGroup | 블록 그룹 분류 |
| `dnd` | BlockDndPolicy | 드래그앤드롭 규칙 |
| `editor` | BlockEditorPolicy | 에디터 동작 규칙 |
| `serialization` | BlockSerializationPolicy | 직렬화 버전·안정 키 |
| `toolbar` | BlockToolbarPolicy | 툴바 종류 |
| `command` | BlockCommandPolicy | 슬래시 메뉴 항목 |

### BlockGroup

`"text"` | `"list"` | `"media"` | `"layout"` | `"database"` | `"embed"` | `"interactive"`

### BlockDndPolicy

| 필드 | 설명 |
|------|------|
| `allowInsideColumns` | 컬럼 레이아웃 내부로 드롭 가능 여부 |
| `allowInsideTabs` | 탭 패널 내부로 드롭 가능 여부 |
| `acceptsChildren` | 다른 블록을 자식으로 받을 수 있는 컨테이너 여부 |

내부 프리셋:
- `movableLeafDnd` — allowInsideColumns: true, allowInsideTabs: true, acceptsChildren: false
- `containerDnd` — allowInsideColumns: true, allowInsideTabs: true, acceptsChildren: true

### BlockEditorPolicy

| 필드 | 설명 |
|------|------|
| `excludeFromUniqueId` | UniqueID extension 부여 대상에서 제외 |
| `flattenBeforeTypeChange` | 타입 변환 전 wrapper를 flatten해야 하는 컨테이너 (callout, toggle 등) |
| `suppressBlockHandle` | 블록 핸들 UI를 숨겨야 하는 내부 구조 노드 (columnLayout, column 등) |

### BlockToolbarPolicy.kind

`"none"` | `"text"` | `"media"` | `"database"` | `"container"`

## 등록된 블록 전체 목록

| id | nodeTypes | group | dnd | toolbar | editor 특이사항 |
|----|-----------|-------|-----|---------|----------------|
| `paragraph` | paragraph | text | leaf | text | — |
| `heading` | heading | text | leaf | text | — |
| `list` | bulletList, orderedList, taskList, listItem, taskItem | list | container | text | — |
| `codeBlock` | codeBlock | text | leaf | text | — |
| `blockquote` | blockquote | text | container | text | flattenBeforeTypeChange |
| `horizontalRule` | horizontalRule | text | leaf | text | — |
| `image` | image | media | leaf | media | — |
| `file` | fileBlock | media | leaf | media | excludeFromUniqueId |
| `pageMention` | mention, pageLink | text | leaf | text | — |
| `database` | databaseBlock | database | leaf | database | — |
| `table` | table, tableRow, tableHeader, tableCell | database | container | container | — |
| `button` | buttonBlock | interactive | leaf | text | — |
| `bookmark` | bookmarkBlock | embed | leaf | media | — |
| `callout` | callout | text | container | container | flattenBeforeTypeChange |
| `toggle` | toggle, toggleHeader, toggleContent | text | container | container | flattenBeforeTypeChange |
| `columns` | columnLayout, column | layout | container (allowInsideColumns: false) | container | suppressBlockHandle |
| `tabs` | tabBlock, tabPanel | layout | container | container | suppressBlockHandle |
| `youtube` | youtube | embed | leaf | media | excludeFromUniqueId |
| `emoji` | emoji, lucideInlineIcon | interactive | leaf | none | excludeFromUniqueId |

## 조회 함수

```
getBlockDefinition(id)                  // id로 BlockDefinition 반환
getBlockDefinitionForNodeType(nodeType) // ProseMirror 노드 타입명으로 BlockDefinition 반환
getSlashMenuEntries()                   // 슬래시 메뉴 전체 항목 반환
```

## defineBlock 헬퍼

`defineBlock(input)` — editor/serialization/toolbar/command 필드의 기본값을 채워 `BlockDefinition` 을 완성한다. serialization 기본값은 `{ schemaVersion: 1, stableType: input.id }`.

## 주의사항

- `nodeTypes` 배열에 나열된 모든 노드 이름은 `blockDefinitionByNodeType` 맵에 등록된다. 여러 노드 타입이 같은 `BlockDefinition`을 공유한다 (예: list).
- `columns` 블록의 `allowInsideColumns: false`는 컬럼 안에 컬럼을 중첩하는 것을 금지하는 유일한 예외다.
- `slashTitles` 필드는 deprecated. `command.slashTitles`를 사용한다.
