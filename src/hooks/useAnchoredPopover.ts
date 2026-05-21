import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export type AnchoredCoords = { top: number; left: number };
const ANCHORED_POPOVER_OPEN_EVENT = "quicknote:anchored-popover-open";

// 화면 가장자리 여백 — 팝업이 뷰포트 밖으로 나가지 않도록 사방에 둔다.
const VIEWPORT_PADDING = 8;

/**
 * 버튼 기준 고정 폭 팝오버 hook.
 *
 * 퀵노트 팝업 규약 (필수)
 * - 모든 드롭다운/팝업 리스트는 절대로 뷰포트 밖으로 잘리지 않아야 한다.
 * - 화면 크기·스크롤 위치·버튼 위치에 따라 동적으로 보정한다.
 * - 새로운 팝업/드롭다운을 만들 때에는 이 hook 또는 동일 클램프·플립 로직을 사용한다.
 *
 * 이 hook 동작:
 * 1. 1차 좌표: 버튼 바로 아래 (rect.bottom + 4).
 * 2. 팝오버가 렌더된 뒤 실제 크기를 측정해, 화면 아래로 넘치면 버튼 위로 플립한다.
 * 3. 좌/우 모두 VIEWPORT_PADDING 안쪽으로 클램프한다.
 * 4. 위로 플립해도 위쪽으로 넘치면 화면 안에 맞춰 top 을 클램프한다.
 */
export function useAnchoredPopover(defaultWidth = 200) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<AnchoredCoords | null>(null);
  const lastWidthRef = useRef<number>(defaultWidth);

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

  /** 버튼/팝오버 크기를 측정해 뷰포트 안쪽으로 클램프 + 위/아래 플립. */
  const computeCoords = useCallback((width: number, height: number | null): AnchoredCoords | null => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // 좌우 클램프
    const maxLeft = vw - width - VIEWPORT_PADDING;
    const left = Math.max(VIEWPORT_PADDING, Math.min(rect.left, maxLeft));

    // 1차: 버튼 아래
    let top = rect.bottom + 4;
    if (height != null) {
      const overflowBottom = top + height > vh - VIEWPORT_PADDING;
      const flippedTop = rect.top - 4 - height;
      const flipFits = flippedTop >= VIEWPORT_PADDING;
      if (overflowBottom && flipFits) {
        top = flippedTop;
      } else if (overflowBottom) {
        // 위/아래 둘 다 안 맞으면 가능한 한 화면 안에 맞춤
        top = Math.max(VIEWPORT_PADDING, vh - height - VIEWPORT_PADDING);
      }
    }
    return { top, left };
  }, []);

  const updatePosition = useCallback((width: number) => {
    lastWidthRef.current = width;
    // 팝오버가 아직 렌더되지 않은 1차 단계에서는 height 없이 추정 위치.
    setCoords(computeCoords(width, null));
  }, [computeCoords]);

  // 팝오버 렌더 후 실제 높이로 재보정.
  useLayoutEffect(() => {
    if (!open) return;
    const el = popoverRef.current;
    if (!el) return;
    const measure = () => {
      const height = el.offsetHeight;
      const width = el.offsetWidth || lastWidthRef.current;
      const next = computeCoords(width, height);
      if (next) setCoords(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, computeCoords]);

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
