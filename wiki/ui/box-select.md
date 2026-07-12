# 박스 드래그 선택 (Box Select)

## 파일
- `src/hooks/boxSelect/useBoxSelectMarquee.ts` — 마퀴 드래그 핵심
- `src/hooks/boxSelect/useBoxSelectDeleteBlocks.ts` — 선택 블록 삭제
- `src/hooks/boxSelect/useBoxSelectDuplicateBlocks.ts` — 선택 블록 복제
- `src/hooks/useBoxSelect.ts` — 조합 훅
- `src/index.css` — `.qn-box-select-rect` 스타일

## 정상 동작 흐름
1. `mousedown` (capture) → `onMouseDown` (`useBoxSelectMarquee.ts`)
2. target 검사 — early return:
   - `editorHost.contains(target)` 외부 → 종료
   - `INTERACTIVE_SELECTOR` 매치 → 종료
   - `isInsideAnyBlock(view, target)` true → 종료
3. 빈 공간이면 `beginMarqueeTracking` → body 에 `qn-box-select-tracking` 추가
4. `mousemove` `MARQUEE_ACTIVATE_PX` 이상 → `qn-box-select-dragging` + `.qn-box-select-rect` 표시
5. `mouseup` → 선택 확정

## 회귀 증상별 원인

| 증상 | 의심 위치 |
|------|-----------|
| 사각형 안 그려짐 | `.qn-box-select-rect` CSS `z-index`/`position` 깨짐 |
| body class 안 붙음 | `onMouseDown` 미호출 — useEffect 미동작 또는 capture listener race |
| `skip:inside-block` | `isInsideAnyBlock` 이 의도치 않게 true |
| `skip:interactive` | 새 ancestor 가 `INTERACTIVE_SELECTOR` 매치 |
| 텍스트 선택됨 | marquee 시작 실패 → PM mousedown fall through |

## 진단 로그 추가
```ts
const dbg = (reason: string) => console.log("[QN-DEBUG] marquee:mousedown", reason, { targetTag: target.tagName })
// 각 early return 직전 dbg("skip:reason"), beginMarqueeTracking 직전 dbg("BEGIN")
```

## 변경 시 주의
- **선택 하이라이트는 스크롤 호스트에 absolute**(`overlayDom.ts getEditorMarqueeHost`) — body fixed
  + scroll 리페인트로 되돌리면 macOS 러버밴드(오버스크롤 텐션) 동안 scroll 이벤트가 없어 파란
  영역만 제자리에 남는다(2026-07-12). 마퀴 드래그 사각형만 body fixed 유지.
- **박스 선택 활성 중 그립 유지**: BlockHandles 는 선택 활성 동안 mousemove hover 갱신을 차단하므로
  `onLeave` 에서 hover 를 지우면 그립이 사라진 뒤 복구 경로가 없다 — 선택 해제 시까지 앵커 그립 유지.
- **z-index 규칙**: 마퀴(310)·선택 하이라이트(300)는 fixed 오버레이라 앱 크롬보다 낮아야 한다
  (TopBar/TabBar `z-[350]` · AI 패널 `z-[400]` · 설정 모달 500). 높이면 스크롤 시 상단 바/사이드
  패널 위로 파란 영역이 떠오르는 회귀(2026-07-12 수정). 값은 `src/lib/boxSelectionVisual.ts`
  `BOX_SELECTION_Z_INDEX` 와 `src/index.css` `.qn-box-select-rect` 두 곳 동기 유지.
- 에디터 컬럼 레이아웃 변경 시 `editor.view.dom.closest()` 가 올바른 host 잡는지 확인
- 새 `absolute/fixed` 엘리먼트 추가 시 marquee overlay 를 가리지 않는지 확인
- 새 mousedown capture listener 가 `stopImmediatePropagation` 하지 않는지 확인
- PM dom padding 영역(`px-12 py-8`)에서도 marquee 시작 가능해야 함
