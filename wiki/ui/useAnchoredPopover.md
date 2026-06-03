# useAnchoredPopover.ts

## 역할
버튼 기준으로 팝오버 좌표를 계산하고, 뷰포트 경계를 넘지 않도록 위/아래 플립 및 좌우 클램프를 자동 처리하는 팝오버 훅. QuickNote 팝업 규약의 표준 구현체.

## 위치
`src/hooks/useAnchoredPopover.ts`

## 주요 exports
| 이름 | 종류 | 설명 |
|------|------|------|
| `useAnchoredPopover` | function | 팝오버 훅 |
| `AnchoredCoords` | type | `{ top: number; left: number }` |

## 반환값
| 필드 | 타입 | 설명 |
|------|------|------|
| `buttonRef` | `RefObject<HTMLButtonElement>` | 트리거 버튼에 부착 |
| `popoverRef` | `RefObject<HTMLDivElement>` | 팝오버 컨테이너에 부착 |
| `open` | `boolean` | 팝오버 열림 여부 |
| `coords` | `AnchoredCoords \| null` | 팝오버 위치 (px, fixed 기준) |
| `toggle` | `(width?, onBeforeOpen?) => void` | 토글 |
| `openPopover` | `(width?, onBeforeOpen?) => void` | 강제 열기 |
| `close` | `() => void` | 닫기 |
| `setOpen` | `Dispatch<SetStateAction<boolean>>` | 직접 제어 |

## 주요 함수
| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|---------|--------|------|
| `computeCoords` | `width, height \| null` | `AnchoredCoords \| null` | 버튼 rect 기반 좌표 계산 + 클램프/플립 |
| `updatePosition` | `width` | `void` | 초기 좌표 설정 (height 미측정 상태) |

## 동작 흐름
1. 트리거 버튼 클릭 → `toggle()` 또는 `openPopover()` 호출
2. `updatePosition(width)` — `buttonRef.getBoundingClientRect()` 로 1차 좌표 설정 (버튼 바로 아래 `rect.bottom + 4`)
3. `notifyOpened()` — `quicknote:anchored-popover-open` 이벤트 dispatch (다른 팝오버 자동 닫기)
4. `open = true` → 팝오버 DOM 렌더
5. `useLayoutEffect` — `popoverRef.offsetHeight` 로 실제 높이 측정 후 `computeCoords` 재계산
6. `computeCoords` 내부 플립/클램프 로직:
   - 팝오버 하단(`top + height`)이 뷰포트 아래로 넘치면 → 버튼 위로 플립 (`rect.top - height - 4`)
   - 위로 플립해도 `top < VIEWPORT_PADDING`이면 `top = VIEWPORT_PADDING` 으로 클램프
   - `left`는 `[VIEWPORT_PADDING, viewportWidth - width - VIEWPORT_PADDING]` 범위로 클램프
7. `ResizeObserver` + `window resize/scroll` 이벤트 → 팝오버 크기·스크롤 변화 시 재계산

## 상수
| 이름 | 값 | 설명 |
|------|----|------|
| `VIEWPORT_PADDING` | 8 | 뷰포트 가장자리 여백(px) |
| `ANCHORED_POPOVER_OPEN_EVENT` | `"quicknote:anchored-popover-open"` | 팝오버 간 상호 닫기 이벤트 |

## 외부 의존
- React `useCallback`, `useEffect`, `useId`, `useLayoutEffect`, `useRef`, `useState`

## 주의사항
- 팝오버 DOM은 반드시 `position: fixed`로 `body`에 Portal 렌더해야 함 — 컨테이너 `overflow: hidden` 안에 두면 클리핑됨
- `useId()`로 팝오버 인스턴스를 구분 — 같은 페이지에 여러 팝오버가 있어도 상호 닫기 정상 동작
- `lastWidthRef`로 마지막 너비를 기억 — 높이 재측정 시 너비 손실 방지
- 새 팝오버/드롭다운 추가 시 반드시 이 훅 사용 또는 동일한 클램프·플립 로직 직접 구현
