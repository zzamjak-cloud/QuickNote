// useAnchoredPopover 를 React 컴포넌트로 래핑.
// 외부 클릭/뷰포트 클램프/플립/다른 팝오버 자동 닫힘은 hook 이 흡수.
// align='right' 일 때 트리거 우측 끝 기준으로 left 를 재계산한다.
import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode } from "react";
import { useAnchoredPopover, type AnchoredCoords } from "../../hooks/useAnchoredPopover";

const VIEWPORT_PADDING = 8;

export interface PopoverTriggerCtx {
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  open: boolean;
  toggle: (width?: number, onBeforeOpen?: () => void) => void;
  openPopover: (width?: number, onBeforeOpen?: () => void) => void;
  close: () => void;
}

export interface PopoverContentCtx {
  close: () => void;
  coords: AnchoredCoords;
  popoverRef: React.RefObject<HTMLDivElement | null>;
}

export interface PopoverBaseProps {
  /** 팝오버 폭 px (useAnchoredPopover 기본값). */
  width?: number;
  /** 트리거 슬롯 — buttonRef 를 바인딩한 버튼을 반환. */
  trigger: (ctx: PopoverTriggerCtx) => ReactNode;
  /** 컨텐츠 슬롯 — open && coords 이 모두 있을 때만 호출. */
  content: (ctx: PopoverContentCtx) => ReactNode;
  /** 컨텐츠 최대 높이 클래스. 기본 max-h-[60vh]. */
  maxHeightClassName?: string;
  /** 컨텐츠 컨테이너 클래스 (배경/테두리 등). */
  contentClassName?: string;
  /** z-index 클래스. 기본 z-[700]. */
  zClassName?: string;
  /** 컨텐츠에 적용할 추가 인라인 스타일. */
  contentStyle?: CSSProperties;
  /** 트리거 좌측(기본) 또는 우측 끝 기준으로 정렬. */
  align?: "left" | "right";
}

const DEFAULT_CONTENT_CLASS =
  "overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900";

export function PopoverBase({
  width = 200,
  trigger,
  content,
  maxHeightClassName = "max-h-[60vh]",
  contentClassName = DEFAULT_CONTENT_CLASS,
  zClassName = "z-[700]",
  contentStyle,
  align = "left",
}: PopoverBaseProps) {
  const pop = useAnchoredPopover(width);

  // align='right' 일 때 트리거 우측 끝 기준으로 left 를 재계산하고 뷰포트 안쪽으로 클램프
  const displayCoords: AnchoredCoords | null = (() => {
    if (!pop.coords) return null;
    if (align !== "right") return pop.coords;
    const rect = pop.buttonRef.current?.getBoundingClientRect();
    if (!rect) return pop.coords;
    const right = rect.right;
    const maxLeft = window.innerWidth - width - VIEWPORT_PADDING;
    const left = Math.max(VIEWPORT_PADDING, Math.min(right - width, maxLeft));
    return { top: pop.coords.top, left };
  })();

  return (
    <>
      {trigger({
        buttonRef: pop.buttonRef,
        open: pop.open,
        toggle: pop.toggle,
        openPopover: pop.openPopover,
        close: pop.close,
      })}
      {pop.open && displayCoords &&
        createPortal(
          <div
            ref={pop.popoverRef}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: displayCoords.top,
              left: displayCoords.left,
              width,
              ...contentStyle,
            }}
            className={`${zClassName} ${maxHeightClassName} ${contentClassName}`}
          >
            {content({
              close: pop.close,
              coords: displayCoords,
              popoverRef: pop.popoverRef,
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
