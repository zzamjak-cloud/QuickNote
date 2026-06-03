# useAnchoredPopover

## 파일
`src/hooks/useAnchoredPopover.ts`

## 역할
트리거 엘리먼트 기준으로 팝오버 위치를 계산하고 화면 경계 내로 클램프.

## API
```ts
const { refs, floatingStyles, isOpen, open, close } = useAnchoredPopover(options)
```

## 동작
1. 트리거 ref + 팝업 ref 연결
2. 팝업이 화면 아래 넘치면 트리거 위로 flip
3. 좌·우 8px 패딩으로 클램프
4. ResizeObserver 로 팝업 크기 변화 시 재계산

## 사용 패턴
```tsx
const { refs, floatingStyles, isOpen, open, close } = useAnchoredPopover()

return (
  <>
    <button ref={refs.setReference} onClick={open}>트리거</button>
    {isOpen && (
      <Portal>
        <div ref={refs.setFloating} style={floatingStyles}>팝업 내용</div>
      </Portal>
    )}
  </>
)
```

## 주의
- 팝업은 반드시 Portal 로 `document.body` 에 렌더 (컨테이너 overflow 영향 차단)
- `floatingStyles` 는 `position: fixed` 기반
