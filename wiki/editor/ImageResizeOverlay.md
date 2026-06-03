# ImageResizeOverlay

## 역할
이미지·동영상·YouTube 노드가 `NodeSelection`으로 선택될 때 해당 미디어 엘리먼트 테두리에 8개 리사이즈 핸들을 오버레이한다. 포인터 드래그로 비율을 유지하며 크기를 조정하고 `updateAttributes`로 `width`/`height`를 저장한다. `createPortal`로 `document.body`에 직접 렌더하여 CSS transform 컨테이닝 블록 문제를 방지한다.

## 위치
`src/components/editor/ImageResizeOverlay.tsx`

## 주요 exports
| 이름 | 종류 | 설명 |
|------|------|------|
| `ImageResizeOverlay` | React 컴포넌트 | 미디어 리사이즈 오버레이 |

## Props
| 필드 | 타입 | 설명 |
|------|------|------|
| `editor` | `Editor \| null` | TipTap 에디터 인스턴스 |

## 주요 상태 (State)
| 이름 | 타입 | 설명 |
|------|------|------|
| `box` | `{pos, left, top, width, height} \| null` | 현재 선택된 미디어의 viewport 기준 rect |

## 주요 ref
| 이름 | 설명 |
|------|------|
| `dragRef` | 현재 드래그 상태 (`DragState`) 보관 |
| `skipSyncRef` | 드래그 중 `measure` 재실행 억제 플래그 |

## 핵심 타입
```
HandleId: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w"

DragState: {
  handle: HandleId
  startX, startY: number      // 드래그 시작 포인터 좌표
  startW, startH: number      // 드래그 시작 시 미디어 크기
  ratio: number               // 종횡비 (width / height)
  pos: number                 // PM 문서 내 노드 위치
}
```

## 주요 함수/액션
| 함수명 | 설명 |
|--------|------|
| `measure` | 현재 선택 노드의 DOM rect를 읽어 `box` 상태 갱신. `skipSyncRef`가 true면 건너뜀 |
| `onPointerDown` | 핸들 드래그 시작. 자연 크기(naturalWidth/videoWidth)로 비율 계산 |
| `onMove` (내부) | 핸들 방향별 newW/newH 계산 후 `editor.chain().updateAttributes()` 실행 |
| `onUp` (내부) | 드래그 종료, `skipSyncRef` 해제 후 `measure` 재실행 |
| `cursorFor` | HandleId → CSS cursor 문자열 변환 |

## measure 로직
1. `editor.state.selection`이 `NodeSelection`인지 확인
2. 노드 타입이 `"image"`, `"youtube"`, 또는 `mime`이 `video/`로 시작하는 `fileBlock`인지 확인
3. `editor.view.nodeDOM(sel.from)` → outer wrapper DOM 획득
4. `wrapper.querySelector("img,video,iframe")`로 실제 미디어 엘리먼트 탐색
5. `(mediaEl ?? wrapper).getBoundingClientRect()`로 viewport 기준 rect 획득
6. `boxOverlayEqual`로 이전 값과 비교 후 변경 시에만 `setBox` 호출

## 크기 조정 계산 (핸들별)
| 핸들 | 동작 |
|------|------|
| `se` | dx와 dy 중 더 큰 비율로 균등 확대 |
| `nw` | dx와 dy 중 더 작은 비율로 균등 축소 |
| `e` / `w` | 가로 방향만 조정, 비율 유지 |
| `n` / `s` | 세로 방향만 조정, 비율 유지 |
| `ne` / `sw` | 대각선 방향 비율 유지 |
- 최솟값: `MIN_PX = 48px`
- 최댓값: 에디터 뷰 DOM 너비(`editor.view.dom.getBoundingClientRect().width`)로 clamp

## 이벤트 구독
`useEffect`에서 다음을 구독하고 cleanup에서 해제:
- `editor.on("selectionUpdate", measure)`
- `editor.on("transaction", measureSoon)` — rAF 경유
- `window.addEventListener("scroll", measure, true)` — 캡처 단계
- `window.addEventListener("resize", measure)`

## 렌더 구조
- `createPortal(..., document.body)` — body 직속으로 렌더
- 오버레이 div: `position: fixed`, `z-index: 660`, `pointer-events-none`
- 핸들 8개: `position: absolute`, `pointer-events: auto`, 10×10px 사각형

## 의존 관계
- `NodeSelection` (`@tiptap/pm/state`) — 선택 타입 판별
- `createPortal` (`react-dom`) — body Portal 렌더

### 이 파일을 사용하는 곳
- `Editor.tsx` — `memo(ImageResizeOverlay)`로 렌더

## 주의사항 (회귀 이력 있음)

- **outer wrapper가 아닌 inner media 측정**: `nodeDOM()`으로 얻은 wrapper는 블록 레벨이라 행 전체 너비를 가질 수 있다. 반드시 `querySelector("img,video,iframe")`로 실제 미디어 엘리먼트를 찾아 측정해야 핸들이 이미지에 정확히 붙는다.
- **CSS transform 컨테이닝 블록**: `DatabaseRowPeek` 같은 조상에 `transform`이 걸리면 `position:fixed`의 기준이 viewport가 아닌 해당 조상이 된다. `createPortal`로 body에 직접 렌더하면 항상 viewport 기준이 된다.
- **z-index 660**: 피크 패널 backdrop/panel이 `z-[650]`이므로 그 위에 떠야 한다.
- **`ImageBlock.addAttributes` 의존**: `width`/`height`가 TipTap 스키마에 등록되어 있어야 `updateAttributes`가 저장된다. `imageBlock.tsx`의 `addAttributes`를 제거하면 크기 조정 후 새로고침 시 원복된다.
- **`skipSyncRef`**: 드래그 중 `measure`가 실행되면 이동 중인 box 크기를 덮어써 드래그가 튀는 현상이 생긴다. 드래그 시작 시 `true`로 세팅하고 `onUp`에서 해제한다.
- **`boxOverlayEqual` 비교**: `BOX_EPS` 임계값 내의 미세한 좌표 변화로 불필요한 리렌더를 방지한다.
