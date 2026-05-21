// 외부 anchorEl + open + onClose 를 controlled 로 받는 패널 베이스.
// useAnchoredPopover 와 달리 부모가 anchor 와 open 상태를 모두 제어한다.
// 예: DatabaseColumnMenu — 컬럼 헤더 DOM 을 anchorEl 로 들고 있고 부모가 open/close 를 관리.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const VIEWPORT_PADDING = 8;

type Coords = { top: number; left: number };

export interface AnchoredPanelBaseProps {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** 패널 폭 px. 기본 240. */
  width?: number;
  /** z-index 클래스. 기본 z-[700]. */
  zClassName?: string;
  /** 컨텐츠 컨테이너 클래스. */
  contentClassName?: string;
  /** anchorEl 외 추가로 외부 클릭 닫힘을 무시할 셀렉터 (예: 보조 팝업). */
  additionalIgnoreSelector?: string;
}

const DEFAULT_CONTENT_CLASS =
  "rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900";

function clampAndFlip(anchor: DOMRect, width: number, height: number | null): Coords {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxLeft = vw - width - VIEWPORT_PADDING;
  const left = Math.max(VIEWPORT_PADDING, Math.min(anchor.left, maxLeft));
  let top = anchor.bottom + 4;
  if (height != null) {
    const overflowBottom = top + height > vh - VIEWPORT_PADDING;
    const flipped = anchor.top - 4 - height;
    if (overflowBottom && flipped >= VIEWPORT_PADDING) {
      top = flipped;
    } else if (overflowBottom) {
      top = Math.max(VIEWPORT_PADDING, vh - height - VIEWPORT_PADDING);
    }
  }
  return { top, left };
}

export function AnchoredPanelBase({
  anchorEl,
  open,
  onClose,
  children,
  width = 240,
  zClassName = "z-[700]",
  contentClassName = DEFAULT_CONTENT_CLASS,
  additionalIgnoreSelector,
}: AnchoredPanelBaseProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<Coords | null>(null);

  // 외부 클릭 닫힘
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (anchorEl?.contains(target)) return;
      if (
        additionalIgnoreSelector &&
        (target as Element).closest?.(additionalIgnoreSelector)
      ) {
        return;
      }
      onClose();
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open, anchorEl, additionalIgnoreSelector, onClose]);

  // ESC 닫힘
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // 위치 측정 + 재측정
  useLayoutEffect(() => {
    if (!open || !anchorEl) return;
    const measure = () => {
      const anchorRect = anchorEl.getBoundingClientRect();
      const panel = panelRef.current;
      const height = panel?.offsetHeight ?? null;
      setCoords(clampAndFlip(anchorRect, width, height));
    };
    measure();
    const observers: ResizeObserver[] = [];
    if (anchorEl) {
      const ro = new ResizeObserver(measure);
      ro.observe(anchorEl);
      observers.push(ro);
    }
    if (panelRef.current) {
      const ro = new ResizeObserver(measure);
      ro.observe(panelRef.current);
      observers.push(ro);
    }
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observers.forEach((o) => o.disconnect());
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, anchorEl, width]);

  if (!open || !anchorEl || !coords) return null;

  return createPortal(
    <div
      ref={panelRef}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top: coords.top,
        left: coords.left,
        width,
      }}
      className={`${zClassName} ${contentClassName}`}
    >
      {children}
    </div>,
    document.body,
  );
}
