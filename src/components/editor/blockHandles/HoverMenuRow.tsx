/**
 * HoverMenuRow — 호버 시 서브패널이 열리는 컨텍스트 메뉴 행 공통 컴포넌트.
 *
 * [gap 문제 해결]
 * onMouseEnter/onMouseLeave 를 trigger <button> 이 아닌 wrapper <div> 에 걸기 때문에
 * 패널이 wrapper 의 DOM 자식인 한 버튼 → 패널 이동 중 mouseleave 가 발화하지 않는다.
 *
 * [겹침 문제 해결]
 * HoverMenuGroup 컨텍스트를 통해 같은 그룹 내 다른 HoverMenuRow 가 열리면 현재 패널을
 * 즉시 닫는다. 그룹 없이 단독 사용하면 독립적으로 동작한다.
 */
import {
  useState,
  useLayoutEffect,
  useRef,
  useContext,
  useCallback,
  createContext,
  type ReactNode,
  type CSSProperties,
} from "react";

// ─── 그룹 컨텍스트 ────────────────────────────────────────────────────────────

type GroupCtx = {
  /** 열린 row 를 그룹에 알림 — 나머지는 즉시 닫힘 */
  notifyOpen: (rowId: number) => void;
  /** close 콜백 등록/해제 */
  subscribe: (rowId: number, close: () => void) => () => void;
};

const HoverMenuGroupContext = createContext<GroupCtx | null>(null);

let _rowIdCounter = 0;

/**
 * 같은 메뉴 안의 HoverMenuRow 들을 감싸면, 한 행이 열릴 때 다른 행들이 즉시 닫힌다.
 */
export function HoverMenuGroup({ children }: { children: ReactNode }) {
  const closeMap = useRef<Map<number, () => void>>(new Map());

  const subscribe = useCallback((rowId: number, close: () => void) => {
    closeMap.current.set(rowId, close);
    return () => { closeMap.current.delete(rowId); };
  }, []);

  const notifyOpen = useCallback((rowId: number) => {
    closeMap.current.forEach((close, id) => {
      if (id !== rowId) close();
    });
  }, []);

  return (
    <HoverMenuGroupContext.Provider value={{ notifyOpen, subscribe }}>
      {children}
    </HoverMenuGroupContext.Provider>
  );
}

// ─── 위치 계산 ────────────────────────────────────────────────────────────────

const GAP_PX = 4;
const VIEWPORT_PAD_PX = 8;
const MIN_HEIGHT_PX = 144;
const DELAY_MS = 200;

function computeSubpanelStyle(
  anchorEl: HTMLElement,
  panelEl: HTMLElement,
  preferredMaxHeight: number,
): CSSProperties {
  const anchorRect = anchorEl.getBoundingClientRect();
  const panelRect = panelEl.getBoundingClientRect();
  const width = panelRect.width || anchorRect.width;
  const measuredHeight = panelRect.height || preferredMaxHeight;

  const canOpenRight =
    anchorRect.right + GAP_PX + width <= window.innerWidth - VIEWPORT_PAD_PX;
  const canOpenLeft =
    anchorRect.left - GAP_PX - width >= VIEWPORT_PAD_PX;
  const openLeft = !canOpenRight && canOpenLeft;

  const availableBelow = window.innerHeight - VIEWPORT_PAD_PX - anchorRect.top;
  const availableAbove = anchorRect.bottom - VIEWPORT_PAD_PX;
  const maxHeight = Math.max(
    MIN_HEIGHT_PX,
    Math.min(preferredMaxHeight, Math.max(availableBelow, availableAbove)),
  );
  const effectiveHeight = Math.min(measuredHeight, maxHeight);

  let top = 0;
  const bottomOverflow =
    anchorRect.top + effectiveHeight - (window.innerHeight - VIEWPORT_PAD_PX);
  if (bottomOverflow > 0) top = -bottomOverflow;
  if (anchorRect.top + top < VIEWPORT_PAD_PX) top = VIEWPORT_PAD_PX - anchorRect.top;

  return {
    left: openLeft ? "auto" : `calc(100% + ${GAP_PX}px)`,
    right: openLeft ? `calc(100% + ${GAP_PX}px)` : "auto",
    top,
    maxHeight,
    overflowY: "auto",
  };
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

type HoverMenuRowProps = {
  icon: ReactNode;
  label: string;
  /** wrapper 상단에 구분선 추가 */
  topSeparator?: boolean;
  /** 패널 너비 Tailwind 클래스 (기본: "w-44") */
  panelWidth?: string;
  preferredMaxHeight?: number;
  children: ReactNode;
};

export function HoverMenuRow({
  icon,
  label,
  topSeparator,
  panelWidth = "w-44",
  preferredMaxHeight = 600,
  children,
}: HoverMenuRowProps) {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const rowId = useRef(++_rowIdCounter);
  const groupCtx = useContext(HoverMenuGroupContext);

  const cancelTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const closeNow = useCallback(() => {
    cancelTimer();
    setOpen(false);
  }, []);

  const handleOpen = () => {
    cancelTimer();
    groupCtx?.notifyOpen(rowId.current); // 다른 행 즉시 닫기
    setOpen(true);
  };

  const handleClose = () => {
    cancelTimer();
    timerRef.current = window.setTimeout(() => setOpen(false), DELAY_MS);
  };

  // 그룹 등록 + 언마운트 정리
  useLayoutEffect(() => {
    const unsub = groupCtx?.subscribe(rowId.current, closeNow);
    return () => {
      cancelTimer();
      unsub?.();
    };
   
  }, [groupCtx, closeNow]);

  // viewport-aware 위치 계산
  useLayoutEffect(() => {
    if (!open || !wrapperRef.current || !panelRef.current) return;
    const anchor = wrapperRef.current;
    const panel = panelRef.current;

    const update = () => {
      setPanelStyle(computeSubpanelStyle(anchor, panel, preferredMaxHeight));
    };

    const rafId = window.requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, preferredMaxHeight]);

  return (
    <div
      ref={wrapperRef}
      className={
        topSeparator
          ? "relative border-t border-zinc-200 dark:border-zinc-700"
          : "relative"
      }
      onMouseEnter={handleOpen}
      onMouseLeave={handleClose}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        <span className="flex items-center gap-2">
          {icon}
          {label}
        </span>
        <span className="text-zinc-400">›</span>
      </button>
      {open && (
        <div
          ref={panelRef}
          className={`absolute left-full top-0 z-50 overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 ${panelWidth}`}
          style={panelStyle}
        >
          {children}
        </div>
      )}
    </div>
  );
}
