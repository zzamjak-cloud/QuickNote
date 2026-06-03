# useBoxSelectMarquee.ts

## 역할
에디터 빈 공간(블록 사이·패딩 영역)에서 마우스 드래그로 점선 사각형(marquee)을 그려 다중 블록을 선택하는 훅. 노션 스타일 박스 선택의 핵심 진입점.

## 위치
`src/hooks/boxSelect/useBoxSelectMarquee.ts`

## 주요 exports
| 이름 | 종류 | 설명 |
|------|------|------|
| `useBoxSelectMarquee` | function | 마퀴 드래그 이벤트 리스너 등록·해제 |

## 파라미터 (Args 타입)
| 필드 | 타입 | 설명 |
|------|------|------|
| `editor` | `Editor` | TipTap 에디터 인스턴스 |
| `startRef` | `RefObject<{x,y} \| null>` | 드래그 시작점 |
| `activeRef` | `RefObject<boolean>` | 마퀴 활성 여부 |
| `dragRectRef` | `RefObject<Rect \| null>` | 현재 마퀴 사각형 |
| `selectedStartsRef` | `RefObject<number[]>` | 선택된 블록 PM 시작 위치 목록 |
| `clearSelection` | `() => void` | 선택 초기화 |
| `setSelectedStarts` | `(v: number[]) => void` | 선택 블록 갱신 |
| `updateSelectionDom` | `(rect: Rect) => void` | 오버레이 DOM 갱신 |

## 주요 내부 함수
| 함수명 | 설명 |
|--------|------|
| `isInsideAnyBlock` | ProseMirror doc 직속 블록(또는 그 후손) 위인지 `elementFromPoint`로 판정 |
| `isPointerNearCaret` | 캐럿 18px 이내 클릭은 텍스트 선택 의도로 간주해 마퀴 시작 차단 |
| `beginMarqueeTracking` | 마퀴 추적 시작 — body에 `qn-box-select-tracking` 클래스 추가 |
| `collapsePmSelectionIfNeeded` | 마퀴 중 PM TextSelection/CellSelection 강제 collapse |
| `lockEditorScroll` / `restoreLockedScroll` | 마퀴 드래그 중 에디터 스크롤 고정·복원 |
| `endMarqueeChrome` | body 클래스 제거 + 스크롤 잠금 해제 |

## 동작 흐름
1. `useEffect` 내에서 `window.addEventListener('mousedown', onMouseDown, true)` capture 등록
2. `onMouseDown` 분기 (순서대로 early return):
   - `e.button !== 0` → 무시
   - `!editorHost.contains(target)` → 무시
   - `isGroupOverlayTarget(target)` → 무시
   - `INTERACTIVE_SELECTOR` 매치 (버튼/input/dialog 등) → 무시 (단, `editor.view.dom` 자체는 허용)
   - `isInsideAnyBlock(view, x, y)` → 무시 (선택 있으면 clearSelection)
   - `isPointerNearCaret(view, x, y)` → 무시
   - 통과 시 `beginMarqueeTracking` 호출
3. `onMouseMove` — `MARQUEE_ACTIVATE_PX` 이상 이동 시 `qn-box-select-dragging` 추가 + `.qn-box-select-rect` div 표시
4. `onMouseUp` — `topLevelBlockStartsInSelectionRange`로 선택 블록 계산 → `setSelectedStarts` + `paintOverlayForPositions`
5. `editor 'update'` 이벤트 — 마퀴 비활성 상태에서 doc 변경 시 선택 초기화

## INTERACTIVE_SELECTOR
```
input, textarea, select, button, a[href], label, [contenteditable],
[data-qn-block-grip], [data-qn-editor-chrome], [data-qn-page-comment],
.tippy-box, [role='menu'], [role='listbox'], [role='dialog']
```

## 마퀴 범위 (marqueeScopeHost)
peek 에디터 호스트 → peek 패널 → body 스크롤 호스트 → 에디터 호스트 → 컬럼 호스트 순으로 fallback. mx-auto 컬럼 바깥 좌우 여백에서도 마퀴 시작 가능.

## 외부 의존
- `@tiptap/react` Editor, `@tiptap/pm/view` EditorView
- `@tiptap/pm/state` TextSelection, `@tiptap/pm/tables` CellSelection
- `topLevelBlockStartsInSelectionRange` (`src/lib/pm/topLevelBlocks`)
- `overlayDom` (`hideGroupOverlay`, `paintOverlayForPositions`)
- `applyBoxMarqueeElementStyle` (`src/lib/boxSelectionVisual`)
- `MARQUEE_ACTIVATE_PX` (`./constants`)

## 주의사항 (회귀 방지)
- `isInsideAnyBlock`은 `hit === view.dom` 케이스에서 반드시 `false` 반환해야 함 — 패딩 영역 마퀴 허용
- 에디터 컬럼 레이아웃 변경 시 `editor.view.dom.closest('[data-qn-editor-column]')` 가 의도한 host를 잡는지 확인 필요
- 새 absolute/fixed element 추가 시 `pointer-events-none` 또는 z-index가 `.qn-box-select-rect` overlay를 가리지 않는지 확인
- 새 mousedown capture listener가 `stopImmediatePropagation` 호출하면 마퀴 전체 비활성화됨
- 진단: body에 `qn-box-select-tracking` 클래스 부착 여부로 `beginMarqueeTracking` 진입 확인 가능
