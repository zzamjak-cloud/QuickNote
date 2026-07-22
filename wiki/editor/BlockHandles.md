# BlockHandles

## 역할
에디터 좌측 거터 영역에 오버레이되는 블록 핸들 레이어. 마우스가 블록 위에 올라가면 드래그 핸들(⠿)과 댓글 추가 버튼을 표시하고, 핸들 클릭 시 블록 타입 변경·정렬·배경색·텍스트 색상·복사·삭제·링크 복사 등 컨텍스트 메뉴를 제공한다. 드래그로 블록 순서를 변경하거나 박스 선택된 블록들을 일괄 이동할 수 있다. `columnLayout` 블록에서는 컬러 변경과 **너비 비율 프리셋(정확히 2컬럼일 때만)** 을 제공한다.

## 위치
`src/components/editor/BlockHandles.tsx`

## 주요 exports
| 이름 | 종류 | 설명 |
|------|------|------|
| `BlockHandles` | React 컴포넌트 | 블록 핸들 오버레이 |

## Props
| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `editor` | `Editor \| null` | — | TipTap 에디터 인스턴스 |
| `boxSelectedStarts` | `readonly number[]` | — | 박스 선택된 블록 시작 위치 목록 |
| `onClearBoxSelection` | `() => void` | — | 박스 선택 해제 콜백 |
| `pageId` | `string \| null` | — | 편집 중인 페이지 ID (피크 뷰 등 activePageId와 다를 때 사용) |
| `compactComments` | `boolean` | `false` | 피크 뷰 등 좁은 컨텍스트에서 댓글을 컴팩트 배지로 표시 |

## 주요 상태 (State)
| 이름 | 타입 | 설명 |
|------|------|------|
| `hover` | `HoverInfo \| null` | 현재 마우스가 올라간 블록 정보 |
| `menuOpen` | `boolean` | 블록 컨텍스트 메뉴 열림 여부 |
| `boxSelecting` | `boolean` | 현재 박스 선택 드래그 진행 중 여부 |
| `isDownloading` | `boolean` | 파일 다운로드 진행 중 여부 |

## 주요 함수/액션
| 함수명 | 설명 |
|--------|------|
| `computeHover` | `blockAtPoint(editor, x, y)` 호출로 현재 마우스 위치의 블록 정보 계산 |
| `flushHover` | rAF 기반 hover 갱신. 그립 존·댓글 버튼 존·리스트 보존 존 등 hysteresis 로직 포함 |
| `onPointerDown` (핸들) | 드래그 vs 클릭 판별. `MARQUEE_ACTIVATE_PX` 이상 이동 시 드래그 커밋 |
| `applyColumnRatio` | 2컬럼 레이아웃의 각 `column` 노드 `width`(flex-grow) attr 을 PM 트랜잭션으로 설정. `hover.blockStart`로 `columnLayout` 노드를 찾아 자식 컬럼 순서대로 비율 적용 |
| `applySharedBlockAlign` | 드롭다운 메뉴 블럭의 `align` attr을 `left | center | right`로 바꾸고 현재 행 안에서 정렬 |
| `resolveHandleTop` | 렌더와 그립 hit-zone 이 같은 Y 좌표식을 공유. `horizontalRule`은 라인 중앙에 28px 핸들을 세로 중앙 정렬 |

## 컬럼 너비 비율 프리셋
- `isTwoColumnLayout`(`columnLayout` && `childCount === 2`)일 때만 컬러 변경 아래에 "너비 비율" 행 노출.
- 버튼: `2:8 / 3:7 / 5:5 / 7:3 / 8:2`. 클릭 시 `applyColumnRatio([l, r])`로 두 컬럼의 `width` attr 설정.
- 적용은 `column` 노드의 `width` attr → `columns.ts` Column `renderHTML`이 inline `flex: <w> 1 0%`로 직접 렌더(=PM 권위). 사후 JS 스타일 적용 방식은 일부 환경에서 무력화되어 폐기됨.

## Hover 보존 로직 (hysteresis)
마우스가 블록에서 인접 영역으로 이동할 때 핸들이 깜빡이지 않도록 아래 경우에 이전 `hover`를 유지한다:

| 상황 | 조건 |
|------|------|
| 그립 존으로 이동 중 | `pointInGripZone(x, y, prev, wrapperRect)` |
| 댓글 추가 아이콘 영역 | `x > prev.rect.right && x <= prev.rect.right + COMMENT_BTN_GAP_PX + 24` |
| 리스트 핸들 → 부모 블록으로 잡힐 때 | `isAncestorListHover && !pointInsideListOwnRow` |
| 리스트 보존 존 (거터 이동 중) | `isListHandleNodeType(prev) && x >= liRect.left - 80` |

`menuOpen`, `boxSelectionActive`는 `ref`로 관리 — mousemove 핸들러가 최신값을 읽되 리스너를 매번 재등록하지 않는다.

## 블록 텍스트 색 (`applyBlockTextColor`)

- `hover.node` 에 `updateAttributes(..., { blockTextColor })` — 글머리·번호·할 일은 **`listItem`/`taskItem` hover** 가 우선(`blockHandles/helpers.ts` `hoverFromListItemElement`).
- `blockBackground` extension 은 `blockTextColor` 를 **`bulletList`/`orderedList`/`taskList` 에 부여하지 않음** — 중첩 목록에서 부모 항목까지 색이 번지는 회귀 방지 ([blocks/block-types.md](../blocks/block-types.md)).

## 핸들 선택 키보드 액션

- 핸들 클릭으로 메뉴가 열린 동안 `Ctrl/Cmd+B`를 누르면 `toggleBlockBold`가 텍스트 블록의
  전체 content 범위를 선택해 굵게를 토글한다. 포커스가 그립/메뉴에 있어도 에디터 단축키와 같은
  결과가 나와야 한다.
- `Backspace`/`Delete`는 `deleteBlockFromHandle`을 사용한다. 단독 자식 `listItem`/`taskItem`만
  지우면 ProseMirror의 `listItem+` 스키마 보정으로 빈 행이 다시 생기므로, 해당 항목이 목록의
  유일한 자식이면 바로 위 목록 컨테이너까지 함께 제거한다. 실제 그립 드래그 뒤 남는
  `NodeSelection`의 기본 Delete 경로도 `useEditorProps`에서 같은 목록 전용 삭제 규칙을 사용한다.
  단, 목록 안 이미지·파일·구분선 등 자식 블록 핸들은 해당 블록만 삭제해야 하므로 목록 범위
  확장은 선택 node 자체가 `listItem`/`taskItem`일 때만 허용한다.

## 박스 선택 감지
`MutationObserver`로 `document.body.classList` 변화를 감시. `qn-box-select-tracking` / `qn-box-select-dragging` 클래스 유무로 `boxSelecting` 상태를 동기화한다.

## 파일 구조 (`blockHandles/` 디렉토리)

`BlockHandles.tsx`에서 분리된 서브모듈(동작 보존 리팩토링):

| 파일 | 역할 |
|------|------|
| `BlockHandlesTypes.ts` | `PinnedCommentBadge`, `DownloadNotice` 등 컴포넌트 공유 타입 |
| `blockTypeFlags.ts` | `computeBlockTypeFlags` — hover/editor 읽기만 의존하는 순수 블록 타입 판별 플래그 |
| `DownloadNoticeToast.tsx` | 첨부 다운로드 진행/성공/실패 토스트 서브컴포넌트 (우하단 고정) |
| `helpers.ts` | 좌표 계산, 호버 판별, 타입 메뉴 상수 등 순수 헬퍼·상수 모음 |
| `HoverMenuRow.tsx` | 서브메뉴 `HoverMenuRow`/`HoverMenuGroup` 컴포넌트 |

## 의존 관계

### 사용하는 유틸 (blockHandles/helpers)
- `blockAtPoint` — 좌표로 블록 탐색
- `pointInGripZone` / `pointInsideListOwnRow` — 마우스 존 판별
- `isAncestorListHover` / `isListHandleNodeType` — 리스트 계층 판별
- `resolveHandleLeft` / `resolveHandleTop` — 핸들 좌표 계산
- `visualElementForBlockNode` — 블록의 시각 기준 DOM 엘리먼트
- `listElementForHover` — 리스트 항목 DOM 엘리먼트
- `unwrapWrapperBlock` — 래퍼 블록 해제
- `applyToggleTitleLevel` — 토글 제목 레벨 변경
- `TYPE_MENU_ITEMS` / `TOGGLE_VARIANT_MENU_ITEMS` — 타입 메뉴 항목 목록
- `COMMENT_BTN_GAP_PX` / `GUTTER_LEFT_PX` / `HANDLE_TOP_OFFSET_PX` / `RECT_PAD_X` / `RECT_PAD_Y` — 레이아웃 상수

### 사용하는 스토어/훅
- `usePageStore` — `activePageId`
- `useUiStore` — `openCommentThread`
- `canBlockHaveComment` (`lib/comments/blockCommentTargets`) — 댓글 가능 블록 여부

### 사용하는 컴포넌트
- `HandleLayerBase` (`handles/HandleLayerBase`) — 핸들 오버레이 베이스 레이어

### 이 파일을 사용하는 컴포넌트
- `Editor.tsx` — 에디터 내부에서 렌더

## 서브메뉴 공통 컴포넌트: HoverMenuRow / HoverMenuGroup

`src/components/editor/blockHandles/HoverMenuRow.tsx`

### 왜 만들었나

이전 구현은 `onMouseEnter`/`onMouseLeave`를 트리거 `<button>`에 걸었다. 버튼을 벗어나는 순간 타이머가 시작되므로:
- **gap 문제**: 버튼 → gap(4px) → 패널 이동 시 타이머가 시작되고, 패널에 도달하기 전에 만료되면 메뉴가 닫혔다.
- **겹침 문제**: 각 서브메뉴가 독립 타이머를 가져서 다른 메뉴 행으로 이동해도 이전 패널이 200ms 동안 남았다.

### 해결 방식

**gap 문제** — `onMouseEnter`/`onMouseLeave`를 wrapper `<div>`에 걸었다. 패널이 wrapper의 DOM 자식이므로 버튼 → 패널 이동 시 wrapper의 `mouseleave`가 발화하지 않는다. gap을 지나는 동안만 200ms 타이머가 돌고, 패널 진입 시 wrapper의 `mouseenter`가 재발화해 타이머를 취소한다.

**겹침 문제** — `HoverMenuGroup` 컨텍스트: 같은 그룹 내에서 한 행이 열리면 (`notifyOpen`) 다른 행들이 즉시 닫힌다 (`closeNow`).

### API

```tsx
// BlockHandles 메뉴 패널 전체를 HoverMenuGroup으로 감싼다
<HoverMenuGroup>
  <HoverMenuRow
    icon={<Baseline size={14} />}
    label="텍스트 컬러"
    panelWidth="w-52"         // 패널 너비 Tailwind 클래스 (기본: "w-44")
    preferredMaxHeight={600}  // viewport-aware 최대 높이 힌트
    topSeparator              // wrapper 상단 구분선
  >
    {/* 패널 내용 — children */}
  </HoverMenuRow>
</HoverMenuGroup>
```

### BlockHandles에서 제거된 것
- `presetOpen`, `bgOpen`, `textColorOpen`, `typeMenuOpen` state
- 8개 anchor/submenu ref 쌍
- `submenuCloseTimers`, `openSubmenu`, `closeSubmenuSoon`
- `SubmenuStyles` 타입 및 `computeViewportAwareSubmenuStyle` 함수
- 서브메뉴 위치 계산 `useLayoutEffect`

## 컬럼 블럭 프리셋 서브메뉴

`columnLayout` 블럭 컨텍스트 메뉴의 "프리셋" 항목에서 접근하는 서브메뉴:

- **None / 프레임 행**: `COLUMN_LAYOUT_PRESETS`에서 `none`(아웃라인·내부 padding/gap 숨김)과 `empty`(회색 테두리) 2개를 텍스트 행으로 표시.
- **컬러칩 그리드**: `CALLOUT_COLOR_CHIP_PRESETS` 8개를 원형 컬러칩으로 표시. 클릭 시 아이콘 없이 배경색만 적용.
- 프리셋 적용 커맨드: `editor.commands.updateColumnLayoutPreset(presetId)` — `setNodeMarkup`으로 선택된 노드만 대상(중첩 컬럼 격리).

## 콜아웃 블럭 프리셋 서브메뉴

`callout` 블럭 컨텍스트 메뉴의 "프리셋" 항목에서 접근하는 서브메뉴:

- **아이콘+라벨 행**: `CALLOUT_PRESETS` 전체(empty/"프레임" 포함)를 이모지+이름 행으로 표시.
- **컬러칩 그리드**: `CALLOUT_COLOR_CHIP_PRESETS` 8개를 원형 컬러칩으로 표시. 클릭 시 아이콘 없이 배경색만 적용(`-plain` 접미사 presetId).
- 프리셋 적용 커맨드: `editor.commands.updateCalloutPreset(presetId)` — `-plain` 계열은 emoji 유지, 일반 계열은 `emoji: null` 리셋.

## 링크 형식 변환 메뉴 (멘션/URL/북마크/버튼)

붙여넣기 링크 선택지(`Editor` 의 `pasteUrlChoice` → 멘션/URL/북마크/버튼·임베드)로 만든 링크를 사후에 서로 변환하는 컨텍스트 메뉴 행("링크 형식 변환").

- 공용 로직: `src/lib/editor/linkBlockConvert.ts`
  - `applyLinkBlockChoice(editor, {url, range, mode})` — 붙여넣기 선택지와 변환 메뉴가 공유. **`insertContentAt(range, content)`** 단일 트랜잭션으로 교체한다(과거 `deleteRange`+`insertContent` 는 stale selection 때문에 드래그핸들 호출 시 문서 끝에 삽입되고 undo 가 깨졌다).
  - `getConvertibleLinkHref(node)` — 변환 가능한 노드면 href 반환, 아니면 null.
- BlockHandles 에서 `linkBlockHref = getConvertibleLinkHref(hover.node)` 가 non-null 일 때만 행을 노출한다.

> **CRITICAL — 노드 종류 차이**: `bookmarkBlock`·`youtube` 는 진짜 블록이라 `hover.node` 가 곧 그 블록이지만, **`buttonBlock`(멘션/버튼)은 `group:"inline" atom`** 이고 `URL` 모드는 인라인 link 마크 텍스트라, 둘 다 드래그핸들 hover 는 이를 감싼 **`paragraph`** 를 잡는다. 따라서 `getConvertibleLinkHref` 는 문단도 검사한다(`pureLinkParagraphHref`): ①인라인 `buttonBlock` 아톰 1개만 있는 문단 → 그 `attrs.href`, ②전체가 동일 link 마크 텍스트인 문단 → 그 href. 링크 외 콘텐츠가 섞이면 변환 대상 아님(문단 통째 교체 사고 방지). **`buttonBlock` 아톰은 `textContent` 에 기여하지 않으므로 `textContent` 빈값으로 조기 제외하면 안 된다.** 내부 페이지 링크(`quicknote://`)·DB 버튼은 `externalWebHref` 가 제외. 회귀 테스트: `src/lib/editor/__tests__/linkBlockConvert.test.ts`.

## 주의사항
- **`pageId` prop 우선**: 피크 뷰처럼 `activePageId`와 다른 페이지를 편집할 때 `pageId` prop을 명시적으로 전달해야 올바른 페이지 ID를 사용한다.
- **`dragCommittedRef`**: 드래그와 클릭을 구분하는 ref. `pointerdown` 후 일정 거리 이상 이동 시 `true`로 전환되어 `pointerup` 시 클릭 이벤트를 차단한다.
- **`clickTimerRef`**: 싱글 클릭과 더블 클릭 구분용 타이머 ref.
- **hover ref 패턴**: `menuOpenRef`, `boxSelectionActiveRef`는 state의 최신값을 ref로 미러링. mousemove 핸들러 deps 배열에서 제거하여 리스너 재등록을 방지한다.
- **`compactComments` 모드**: 피크 뷰 등 좁은 패널에서는 댓글 버튼이 컴팩트 배지 형태로 표시된다.
- **서브메뉴 높이(스크롤바 방지)**: `HoverMenuRow`의 `preferredMaxHeight` prop으로 최대 높이를 정한다. 프리셋·텍스트 컬러·배경 서브메뉴는 항목 수 대비 스크롤바가 생기지 않도록 `600`을 사용한다(과거 256/320에서 상향).
