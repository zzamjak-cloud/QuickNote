# 블록 Policy 파일들

`src/lib/blocks/editorPolicy.ts` / `dndPolicy.ts` / `uiPolicy.ts`

세 파일은 registry의 `BlockDefinition`을 읽어 에디터·DnD·UI 레이어에서 필요한 판별 로직을 제공한다. TipTap 확장이나 React 컴포넌트가 직접 registry를 파싱하는 대신 이 함수들을 호출한다.

---

## editorPolicy.ts

### 역할

에디터 초기화 및 doc 구조 판별에 관한 순수 함수 모음.

### exports

#### `EDITOR_UNIQUE_ID_TYPES`

UniqueID extension을 부여할 노드 타입 이름 배열. `blockDefinitions`에서 자동 계산된다.
제외 기준: `UNIQUE_ID_EXCLUDED_NODE_TYPES` 집합(`emoji`, `fileBlock`, `image`, `lucideInlineIcon`, `mention`, `youtube`)에 속하거나 `editor.excludeFromUniqueId === true`인 노드.

#### `isDatabaseBlockType(nodeType)`

nodeType이 `database` 블록에 속하는지 반환.

#### `getFirstDatabaseBlockId(doc)`

JSONContent doc의 첫 블록이 databaseBlock이면 `databaseId` attr 값을 반환, 아니면 null.

#### `isFullPageDatabaseDoc(doc)`

doc 첫 블록이 `layout: "fullPage"` databaseBlock인지 판별. 전체 페이지 DB 뷰 전환 여부 결정에 사용.

#### `normalizeFullPageDatabaseDoc(doc)`

`isFullPageDatabaseDoc`이 true이고 블록이 2개 이상이면, 첫 번째 databaseBlock만 남긴 doc을 반환한다. fullPage DB 뒤에 불필요한 블록이 쌓이는 것을 방지.

---

## dndPolicy.ts

### 역할

블록 드래그앤드롭 시 특정 컨테이너 안으로 드롭 가능한지 판별.

### 타입

```
DropContainerType = "doc" | "column" | "tabPanel" | "toggleContent" | "callout"
```

### exports

#### `canDropNodeTypeInContainers(nodeType, containers)`

드래그 중인 블록(`nodeType`)을 현재 드롭 대상 컨테이너 스택(`containers`)에 놓을 수 있는지 반환.

판별 규칙:
- `containers`가 `["doc"]` 단독이면 무조건 허용 (최상위 레벨).
- `"column"`이 포함되고 해당 블록의 `dnd.allowInsideColumns === false`이면 → 금지. (`columns` 블록 자신이 해당)
- `"tabPanel"`이 포함되고 `dnd.allowInsideTabs === false`이면 → 금지.
- `"toggleContent"`, `"callout"`은 별도 제약 없이 ProseMirror schema에 위임.
- 정의가 없는 nodeType은 허용.

---

## uiPolicy.ts

### 역할

블록 핸들 UI 표시 여부 및 블록 특성 판별 함수 모음. 에디터 컴포넌트 레이어에서 직접 `BlockDefinition`을 참조하지 않도록 추상화.

### exports

#### `shouldSuppressBlockHandle(nodeType)`

블록 핸들(그립 버튼)을 표시하지 않아야 하는 노드 타입인지 반환.

억제 대상 (하드코딩):
- `columnLayout`, `column` — 컬럼 레이아웃 내부 구조
- `toggleHeader`, `toggleContent` — 토글 내부 구조
- `bulletList`, `orderedList`, `taskList` — 리스트 컨테이너 (개별 listItem/taskItem이 핸들 담당)

추가로 `editor.suppressBlockHandle === true`인 블록도 억제됨.

#### `shouldFlattenWrapperBeforeTypeChange(nodeType)`

블록 타입 변경 전 wrapper를 flatten해야 하는지 반환.
대상: `callout`, `toggle`, `blockquote` (하드코딩) + `editor.flattenBeforeTypeChange === true` 블록.

#### `shouldUseDatabaseBlockChrome(nodeType)`

블록 핸들 배치 시 DB 전용 크롬(`.qn-database-block` wrapper)을 기준으로 rect를 계산해야 하는지 반환.

#### `isAttachmentBlockNodeType(nodeType)`

파일 블록(`file` id)인지 반환.

#### `isCalloutBlockNodeType(nodeType)`

콜아웃 블록(`callout` id)인지 반환.
