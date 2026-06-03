# BlockHandles

## 역할
에디터 좌측 거터 영역에 오버레이되는 블록 핸들 레이어. 마우스가 블록 위에 올라가면 드래그 핸들(⠿)과 댓글 추가 버튼을 표시하고, 핸들 클릭 시 블록 타입 변경·배경색·텍스트 색상·복사·삭제·링크 복사 등 컨텍스트 메뉴를 제공한다. 드래그로 블록 순서를 변경하거나 박스 선택된 블록들을 일괄 이동할 수 있다.

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
| `presetOpen` | `boolean` | 콜아웃 프리셋 메뉴 열림 여부 |
| `bgOpen` | `boolean` | 배경색 선택 메뉴 열림 여부 |
| `textColorOpen` | `boolean` | 텍스트 색상 메뉴 열림 여부 |
| `typeMenuOpen` | `boolean` | 블록 타입 변경 메뉴 열림 여부 |
| `boxSelecting` | `boolean` | 현재 박스 선택 드래그 진행 중 여부 |
| `isDownloading` | `boolean` | 파일 다운로드 진행 중 여부 |

## 주요 함수/액션
| 함수명 | 설명 |
|--------|------|
| `computeHover` | `blockAtPoint(editor, x, y)` 호출로 현재 마우스 위치의 블록 정보 계산 |
| `flushHover` | rAF 기반 hover 갱신. 그립 존·댓글 버튼 존·리스트 보존 존 등 hysteresis 로직 포함 |
| `onPointerDown` (핸들) | 드래그 vs 클릭 판별. `MARQUEE_ACTIVATE_PX` 이상 이동 시 드래그 커밋 |

## Hover 보존 로직 (hysteresis)
마우스가 블록에서 인접 영역으로 이동할 때 핸들이 깜빡이지 않도록 아래 경우에 이전 `hover`를 유지한다:

| 상황 | 조건 |
|------|------|
| 그립 존으로 이동 중 | `pointInGripZone(x, y, prev, wrapperRect)` |
| 댓글 추가 아이콘 영역 | `x > prev.rect.right && x <= prev.rect.right + COMMENT_BTN_GAP_PX + 24` |
| 리스트 핸들 → 부모 블록으로 잡힐 때 | `isAncestorListHover && !pointInsideListOwnRow` |
| 리스트 보존 존 (거터 이동 중) | `isListHandleNodeType(prev) && x >= liRect.left - 80` |

`menuOpen`, `boxSelectionActive`는 `ref`로 관리 — mousemove 핸들러가 최신값을 읽되 리스너를 매번 재등록하지 않는다.

## 박스 선택 감지
`MutationObserver`로 `document.body.classList` 변화를 감시. `qn-box-select-tracking` / `qn-box-select-dragging` 클래스 유무로 `boxSelecting` 상태를 동기화한다.

## 의존 관계

### 사용하는 유틸 (blockHandles/helpers)
- `blockAtPoint` — 좌표로 블록 탐색
- `pointInGripZone` / `pointInsideListOwnRow` — 마우스 존 판별
- `isAncestorListHover` / `isListHandleNodeType` — 리스트 계층 판별
- `resolveHandleLeft` — 핸들 X 좌표 계산
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

## 주의사항
- **`pageId` prop 우선**: 피크 뷰처럼 `activePageId`와 다른 페이지를 편집할 때 `pageId` prop을 명시적으로 전달해야 올바른 페이지 ID를 사용한다.
- **`dragCommittedRef`**: 드래그와 클릭을 구분하는 ref. `pointerdown` 후 일정 거리 이상 이동 시 `true`로 전환되어 `pointerup` 시 클릭 이벤트를 차단한다.
- **`clickTimerRef`**: 싱글 클릭과 더블 클릭 구분용 타이머 ref.
- **hover ref 패턴**: `menuOpenRef`, `boxSelectionActiveRef`는 state의 최신값을 ref로 미러링. mousemove 핸들러 deps 배열에서 제거하여 리스너 재등록을 방지한다.
- **`compactComments` 모드**: 피크 뷰 등 좁은 패널에서는 댓글 버튼이 컴팩트 배지 형태로 표시된다.
