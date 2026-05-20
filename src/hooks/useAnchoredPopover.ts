import { useCallback, useEffect, useId, useRef, useState } from "react";

export type AnchoredCoords = { top: number; left: number };
const ANCHORED_POPOVER_OPEN_EVENT = "quicknote:anchored-popover-open";

/** 버튼 아래 고정 폭 팝오버 — outside mousedown으로 닫기, 좌표는 뷰포트 내로 클램프 */
export function useAnchoredPopover(defaultWidth = 200) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<AnchoredCoords | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: PointerEvent) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      if (buttonRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    // 캡처 단계에서 먼저 감지해 셀 내부 stopPropagation 영향 없이 닫는다.
    window.addEventListener("pointerdown", handler, true);
    return () => window.removeEventListener("pointerdown", handler, true);
  }, [open]);

  useEffect(() => {
    const closeOnOtherPopoverOpen = (event: Event) => {
      const sourceId = (event as CustomEvent<{ sourceId?: string }>).detail?.sourceId;
      if (!sourceId || sourceId === popoverId) return;
      setOpen(false);
    };
    window.addEventListener(ANCHORED_POPOVER_OPEN_EVENT, closeOnOtherPopoverOpen);
    return () =>
      window.removeEventListener(ANCHORED_POPOVER_OPEN_EVENT, closeOnOtherPopoverOpen);
  }, [popoverId]);

  const notifyOpened = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent(ANCHORED_POPOVER_OPEN_EVENT, {
        detail: { sourceId: popoverId },
      }),
    );
  }, [popoverId]);

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
      notifyOpened();
      setOpen(true);
    },
    [open, defaultWidth, notifyOpened, updatePosition],
  );

  const openPopover = useCallback(
    (width: number = defaultWidth, onBeforeOpen?: () => void) => {
      onBeforeOpen?.();
      updatePosition(width);
      notifyOpened();
      setOpen(true);
    },
    [defaultWidth, notifyOpened, updatePosition],
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
