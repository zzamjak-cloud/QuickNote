import { useCallback, useLayoutEffect, useRef, useState } from "react";

// 트리거 버튼 기준으로 아래(기본)/위로 열리는 방향을 결정하는 경량 훅.
// 부유 툴바(BubbleToolbar) 처럼 이미 fixed portal 안에 있고, 팝오버가 트리거의
// 형제(absolute)로 렌더되는 단순 케이스용 — 하단 가장자리에서 잘리면 위로 뒤집는다.
// (셀/버튼 기준 일반 팝오버는 useAnchoredPopover 를 쓸 것. wiki/ui/popup-clipping.md)
export function usePopoverFlip<T extends HTMLElement>(
  open: boolean,
  estimatedHeight: number,
): { triggerRef: React.RefObject<T | null>; dropUp: boolean; recompute: () => void } {
  const triggerRef = useRef<T | null>(null);
  const [dropUp, setDropUp] = useState(false);

  const recompute = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    // 아래 공간이 부족하고 위 공간이 더 넉넉하면 위로 뒤집는다(8px 여유).
    setDropUp(spaceBelow < estimatedHeight + 8 && spaceAbove > spaceBelow);
  }, [estimatedHeight]);

  useLayoutEffect(() => {
    if (!open) return;
    recompute();
  }, [open, recompute]);

  return { triggerRef, dropUp, recompute };
}
