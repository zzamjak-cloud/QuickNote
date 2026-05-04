import { useCallback, useEffect, useRef, useState } from "react";

export type AnchoredCoords = { top: number; left: number };

/** 버튼 아래 고정 폭 팝오버 — outside mousedown으로 닫기, 좌표는 뷰포트 내로 클램프 */
export function useAnchoredPopover(defaultWidth = 200) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<AnchoredCoords | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      if (buttonRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const updatePosition = useCallback((width: number) => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(rect.left, window.innerWidth - width - 8);
    setCoords({ top: rect.bottom + 4, left: Math.max(8, left) });
  }, []);

  const toggle = useCallback(
    (width: number = defaultWidth, onBeforeOpen?: () => void) => {
      if (open) {
        setOpen(false);
        return;
      }
      onBeforeOpen?.();
      updatePosition(width);
      setOpen(true);
    },
    [open, defaultWidth, updatePosition],
  );

  const openPopover = useCallback(
    (width: number = defaultWidth, onBeforeOpen?: () => void) => {
      onBeforeOpen?.();
      updatePosition(width);
      setOpen(true);
    },
    [defaultWidth, updatePosition],
  );

  const close = useCallback(() => setOpen(false), []);

  return {
    buttonRef,
    popoverRef,
    open,
    coords,
    toggle,
    openPopover,
    close,
    setOpen,
  };
}
