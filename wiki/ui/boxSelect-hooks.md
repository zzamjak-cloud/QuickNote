# boxSelect 훅 모음

## 역할
에디터 박스 드래그 선택 기능을 역할별로 분리한 훅·유틸 모음. `useBoxSelectMarquee`가 핵심이며 나머지는 선택 후 동작을 담당한다.

## 위치
`src/hooks/boxSelect/`

## 파일 목록

| 파일 | 역할 |
|------|------|
| `useBoxSelectMarquee.ts` | 마우스 드래그 → marquee 사각형 그리기 + 블록 선택 (핵심, 별도 문서 참조) |
| `useBoxSelectCommittedOverlay.ts` | 선택 확정 후 블록 강조 오버레이 유지·갱신 |
| `useBoxSelectDeleteBlocks.ts` | 선택된 블록 일괄 삭제 (Backspace/Delete 키 처리) |
| `useBoxSelectDuplicateBlocks.ts` | 선택된 블록 일괄 복제 |
| `useBoxSelectEscape.ts` | Escape 키로 박스 선택 해제 |
| `useBoxSelectPmOverlay.ts` | ProseMirror selection 변경 시 오버레이 동기화 |
| `constants.ts` | 공유 상수 (`MARQUEE_ACTIVATE_PX` 등) |
| `hitTest.ts` | `isGroupOverlayTarget` 등 hit-test 유틸 |
| `overlayDom.ts` | `paintOverlayForPositions`, `hideGroupOverlay` — 오버레이 DOM 직접 조작 |
| `types.ts` | `Rect` 등 공유 타입 |

## 주요 상수 (constants.ts)
| 이름 | 설명 |
|------|------|
| `MARQUEE_ACTIVATE_PX` | 드래그가 마퀴로 전환되는 최소 이동 거리(px) |

## 오버레이 동작 구조

```
useBoxSelectMarquee          ← mousedown/move/up 감지, 블록 위치 계산
        ↓
setSelectedStarts([...pos])  ← PM 문서 내 블록 시작 위치 배열
        ↓
paintOverlayForPositions()   ← overlayDom.ts — 각 블록 위에 하이라이트 div 렌더
        ↓
useBoxSelectCommittedOverlay ← scroll/resize 시 오버레이 위치 재계산
```

## useBoxSelectCommittedOverlay
- `selectedStartsRef`가 변경될 때마다 `paintOverlayForPositions` 호출
- scroll·resize 이벤트에서 오버레이 위치 재갱신

## useBoxSelectDeleteBlocks
- `selectedStartsRef`에 블록이 있을 때 `Backspace`/`Delete` 키 → 선택 블록 전체 PM transaction으로 삭제
- 삭제 후 `clearSelection()` 호출

## useBoxSelectDuplicateBlocks
- 선택된 블록들을 복제해 마지막 블록 바로 아래에 삽입
- 복제 후 새 블록들을 선택 상태로 전환

## useBoxSelectEscape
- `Escape` 키 → `clearSelection()` + PM selection collapse

## useBoxSelectPmOverlay
- `editor 'selectionUpdate'` 이벤트 감지
- PM selection이 2개 이상 최상위 블록을 포함하면 오버레이 표시
- selection이 단일 커서로 줄어들면 오버레이 숨김

## overlayDom.ts 주요 함수
| 함수명 | 설명 |
|--------|------|
| `paintOverlayForPositions` | PM 위치 배열로부터 각 블록 DOM rect를 측정해 오버레이 div 생성·업데이트 |
| `hideGroupOverlay` | 오버레이 전체 숨김 |

## 주의사항
- 오버레이 div는 에디터 외부(body 레벨)가 아닌 에디터 내부 특정 컨테이너에 부착 — z-index 관리 주의
- `quicknote-block-dragging` body 클래스가 있는 동안(그립 드래그 중)은 `clearSelectionAfterDocChange` 억제
- 블록 삭제·복제는 PM transaction을 직접 사용 — Zustand 스토어 직접 조작 금지
