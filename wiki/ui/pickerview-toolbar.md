# 피커뷰 툴바/팝업 회귀 방지

## 반복 회귀 증상
- 우측 화면 밖으로 밀림
- 피커뷰 팝업 뒤로 숨음
- 스크롤 컨테이너 기준 좌표를 `fixed` 좌표처럼 쓰는 문제

## 필수 규칙
1. 툴바/드롭다운은 피커뷰 내부 DOM 이 아니라 `document.body` Portal 로 렌더
2. 좌표 계산: 대상 element 의 `getBoundingClientRect()` + `visualViewport.offsetLeft/offsetTop`
3. X축: `viewportLeft + padding` ~ `viewportLeft + viewportWidth - popupWidth - padding` 으로 clamp
4. Y축: 아래 우선 배치 후 부족하면 위로 flip, resize/scroll/크기 변화 시 재계산
5. z-index: 피커뷰 패널보다 높아야 함

## 배치 기준
미디어 블럭 툴바 → block wrapper 전체가 아니라 **실제 이미지/비디오/파일 shell rect** 기준

---

## 피크 패널 `transform` 으로 인한 `position: fixed` 좌표 오류

### 원인
피크 패널(`DatabaseRowPeek.tsx`)은 슬라이드 애니메이션을 위해 `transition-transform` + `translate-x-0`을 사용한다. CSS 스펙상 `transform` 값이 적용된 요소는 `position: fixed` 자식의 **containing block**이 된다. 결과적으로 `position: fixed` 자식이 뷰포트 기준이 아닌 패널 기준으로 위치해, `getBoundingClientRect()`(뷰포트 좌표)로 계산한 좌표와 불일치가 발생한다.

```
패널 left = 600px (뷰포트 기준)
표 컬럼 rect.left = 620px (뷰포트 기준)
fixed 핸들 style.left = 620 → 실제 화면: 600 + 620 = 1220px → 화면 밖!
```

### 영향 범위
피크 패널 내부 React 트리에서 렌더되는 모든 `position: fixed` UI:
- `TableBlockControls` 컬럼/행 핸들
- `ImageResizeOverlay`
- 팝업, 드롭다운 등 fixed 좌표 기반 요소

### 해결 패턴
**`createPortal(..., document.body)` 로 탈출 + z-index `z-[660]` 이상 사용**

```tsx
// TableBlockControls 적용 예
{createPortal(
  <HandleLayerBase positioning="fixed" zClassName="z-[660]" ...>
    {/* 핸들 버튼들 — getBoundingClientRect() 좌표 정상 적용됨 */}
  </HandleLayerBase>,
  document.body
)}
```

- `document.body`에 포털하면 transformed ancestor를 탈출 → `position: fixed`가 뷰포트 기준으로 동작
- `z-[660]`은 피크 backdrop(`z-[650]`) 위에, 피크 내부 다이얼로그(`z-[700]`) 아래

### 체크리스트 — 피크 내 fixed UI 추가 시
- [ ] `position: fixed` 를 쓰는가? → `createPortal(..., document.body)` 필수
- [ ] `position: absolute` 를 쓰는가? → transformed ancestor 영향 없음, 단 **overflow-hidden 패널 clipping** 주의
- [ ] z-index: 피크 backdrop(z-650) 위 → 최소 `z-[660]` 이상
- [ ] 좌표 계산은 `getBoundingClientRect()` + 포털 이후에만 정확

### `ScrollToTopButton` — 조상 ref null 타이밍 버그 (실측 확인)
증상: 스크롤해도 "맨 위로" 버튼이 **전혀** 안 뜸 (main 에디터·DB 항목 페이지·피크뷰 전부).

원인: 버튼은 `scrollRef` 가 가리키는 스크롤 컨테이너의 **자식**으로 렌더된다. React 의 ref attach(`commitAttachRef`)는 bottom-up(자식 먼저)이라, 자식인 버튼의 effect 가 실행되는 시점에 **조상 컨테이너의 `scrollRef.current` 가 아직 null** 일 수 있다.
- `useLayoutEffect` 는 commit layout phase 에서 bottom-up 으로 실행 → 조상 ref 미부착 → `host=null` → early return → 리스너 미등록 → 버튼 영구 미표시. (❌ `useLayoutEffect` 로 바꾸면 오히려 깨짐)

해결: `useEffect` + **rAF 재시도** 로 `scrollRef.current` 가 채워질 때까지 기다렸다가 리스너 등록.
```tsx
const attach = () => {
  host = scrollRef.current;
  if (!host) { raf = requestAnimationFrame(attach); return; } // ref 채워질 때까지 재시도
  update();
  host.addEventListener("scroll", update, { passive: true });
};
attach();
```
검증: Playwright 로 `host.scrollTop=300` 후 `button[aria-label="맨 위로"]` DOM 존재 + 뷰포트 내 위치 확인.

기타 주의:
- 피크 내 `position="absolute"` 버튼은 스크롤 컨테이너(`overflow-y-auto`) **밖** 에 위치해야 한다 (inside면 스크롤 시 clipping 가능)
- z-index: 피크 backdrop(z-650) 위 → `z-[660]`

## 검증 체크리스트
- [ ] 피커뷰를 오른쪽 가장자리에서 열기
- [ ] 좁은 화면에서 열기
- [ ] 스크롤 중간 상태에서 열기
- [ ] 이미지/동영상 툴바가 화면 안에 남는지 확인
- [ ] 피커뷰 뒤로 숨지 않는지 확인
- [ ] hover/click 대상이 가려지지 않는지 확인
