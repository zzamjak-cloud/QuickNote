import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { Rnd } from "react-rnd";
import { PanelRight } from "lucide-react";
import type { ViewConfigsMap } from "../../../types/database";
import { DAY_MS } from "../../../lib/database/timelineGeometry";
import { getScheduleCardContentOffset } from "../../scheduler/scheduleCardDisplay";
import { ContextMenu, announceSchedulerContextMenuOpen } from "../../scheduler/ContextMenu";
import { TimelineCardText } from "../TimelineCardText";
import { TimelineCardPropertyLabels } from "../TimelineCardPropertyLabels";
import { ScheduleCardDetailRows } from "../ScheduleCardDetailRows";
import { ROW_HEIGHT, UNSCHEDULED_CARD_LEFT } from "./timelineLayoutConstants";
import type { ContextPointerEvent, TimelineCardLayout } from "./timelineTypes";

// 드래그 이동 활성 임계값(px) — 이보다 작은 이동은 클릭으로 간주(선택).
const DRAG_ACTIVATE_PX = 3;

// 타임라인 단일 카드 — react-rnd 기반 드래그/리사이즈, 호버 툴팁(포털),
// 우클릭 색상 컨텍스트 메뉴(포털). 부모와는 props 계약으로만 통신한다.
export function DatabaseTimelineCard({
  card,
  databaseId,
  excludeColumnIds,
  viewConfigs,
  axisMinT,
  pxPerDay,
  scrollLeft,
  layoutSyncKey,
  selected,
  multiSelected,
  multiDragDeltaX,
  onSelect,
  onOpenPeek,
  onMove,
  onResize,
  onColorChange,
  onMultiDragStart,
  onMultiDragMove,
  onMultiDragEnd,
  lockScroll,
  unlockScroll,
}: {
  card: TimelineCardLayout;
  databaseId: string;
  excludeColumnIds: readonly string[];
  viewConfigs: ViewConfigsMap | undefined;
  axisMinT: number;
  pxPerDay: number;
  scrollLeft: number;
  layoutSyncKey: string;
  selected: boolean;
  multiSelected: boolean;
  multiDragDeltaX: number | null;
  onSelect: (card: TimelineCardLayout) => void;
  onOpenPeek: (pageId: string) => void;
  onMove: (card: TimelineCardLayout, deltaDays: number) => void;
  onResize: (card: TimelineCardLayout, start: number, end: number) => void;
  onColorChange: (card: TimelineCardLayout, color: string) => void;
  onMultiDragStart: () => void;
  onMultiDragMove: (deltaX: number) => void;
  onMultiDragEnd: (deltaDays: number) => void;
  lockScroll: () => void;
  unlockScroll: () => void;
}) {
  const rndRef = useRef<Rnd | null>(null);
  const [localX, setLocalX] = useState(card.left);
  const [localW, setLocalW] = useState(card.width);
  const dragMovedRef = useRef(false);
  const resizeStartRef = useRef<{ startIdx: number; endIdx: number } | null>(null);
  // 호버 툴팁 위치 — LC 스케줄러 카드와 동일한 상세 속성 툴팁을 띄운다.
  const [tipPos, setTipPos] = useState<{ top: number; left: number; placeAbove: boolean } | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    // 미등록(날짜 없음) 카드는 가로 스크롤과 무관하게 항상 항목열 우측에 고정한다.
    // (scrollLeft 만큼 더해 트랙이 스크롤돼도 화면상 같은 위치 유지 — LC 스케줄러와 동일)
    setLocalX(card.isUnscheduled ? scrollLeft + card.left : card.left);
    setLocalW(card.width);
  }, [card.left, card.width, card.isUnscheduled, scrollLeft]);

  const measuredX = card.isUnscheduled ? scrollLeft + card.left : card.left;
  useLayoutEffect(() => {
    // react-rnd 는 mount 때 부모 offset 을 캐시하므로, 0폭/transform 전환 뒤 remount 없이 재측정한다.
    if (multiDragDeltaX != null) return;
    const rnd = rndRef.current;
    if (!rnd) return;
    rnd.updateOffsetFromParent();
    const { left, top } = rnd.offsetFromParent;
    rnd.updatePosition({ x: measuredX - left, y: card.top - top });
    rnd.forceUpdate();
  }, [card.top, layoutSyncKey, measuredX, multiDragDeltaX]);

  const safePxPerDay = Math.max(pxPerDay, 1);
  const visualX =
    !card.isUnscheduled && multiDragDeltaX != null
      ? card.left + multiDragDeltaX
      : localX;
  // 긴 카드가 좌측으로 스크롤될 때 텍스트를 화면 안에 유지 (LC 스케줄러와 동일)
  const contentOffset = card.isUnscheduled
    ? 0
    : getScheduleCardContentOffset({ scrollLeft, cardLeft: visualX, cardWidth: localW });
  const titleClassName = card.isUnscheduled
    ? "font-medium text-zinc-700 dark:text-zinc-200"
    : "font-medium text-white";
  const dateClassName = card.isUnscheduled
    ? "text-xs text-zinc-400 dark:text-zinc-500"
    : "text-xs text-white/80";
  const labelTextClassName = card.isUnscheduled
    ? "text-zinc-500 dark:text-zinc-400"
    : "text-white/80";

  const openContextMenu = useCallback(
    (event: ContextPointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      announceSchedulerContextMenuOpen();
      setTipPos(null);
      onSelect(card);
      setContextMenuPos({ left: event.clientX, top: event.clientY });
    },
    [card, onSelect],
  );

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => openContextMenu(event),
    [openContextMenu],
  );

  const handleRndMouseDown = useCallback(
    (event: MouseEvent) => {
      if (event.button === 2) {
        openContextMenu(event);
      }
    },
    [openContextMenu],
  );

  const handleCardMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.button === 2) {
        openContextMenu(event);
        return;
      }
      onSelect(card);
    },
    [card, onSelect, openContextMenu],
  );

  return (
    <>
    <Rnd
      ref={rndRef}
      data-db-timeline-card="true"
      data-db-timeline-card-page={card.row.pageId}
      data-db-timeline-card-id={card.id}
      // 미등록 카드는 포커싱 애니메이션 중 매 프레임 DOM 으로 화면 고정(applyUnscheduledCardPin).
      {...(card.isUnscheduled
        ? { "data-unscheduled-card": UNSCHEDULED_CARD_LEFT, "data-card-top": card.top }
        : {})}
      position={{ x: visualX, y: card.top }}
      size={{ width: Math.max(localW, 24), height: ROW_HEIGHT - 4 }}
      dragAxis="x"
      dragGrid={[1, 1]}
      resizeGrid={[safePxPerDay, 1]}
      minWidth={card.isUnscheduled ? 96 : safePxPerDay}
      enableResizing={
        card.isUnscheduled
          ? false
          : {
              left: true,
              right: true,
              top: false,
              bottom: false,
              topLeft: false,
              topRight: false,
              bottomLeft: false,
              bottomRight: false,
            }
      }
      resizeHandleStyles={{
        left: { cursor: "ew-resize", width: 8, left: 0 },
        right: { cursor: "ew-resize", width: 8, right: 0 },
      }}
      onDragStart={() => {
        dragMovedRef.current = false;
        setContextMenuPos(null);
        if (multiSelected) onMultiDragStart();
      }}
      onDrag={(_event, data) => {
        const deltaX = data.x - card.left;
        if (Math.abs(deltaX) > DRAG_ACTIVATE_PX) dragMovedRef.current = true;
        if (multiSelected) {
          onMultiDragMove(deltaX);
          return;
        }
        setLocalX(data.x);
      }}
      onDragStop={(_event, data) => {
        if (!dragMovedRef.current) {
          onSelect(card);
          return;
        }
        if (card.isUnscheduled) {
          const startIdx = Math.max(0, Math.round(data.x / safePxPerDay));
          const start = axisMinT + startIdx * DAY_MS;
          setLocalX(card.left);
          onResize(card, start, start);
          return;
        }
        const deltaDays = Math.round((data.x - card.left) / safePxPerDay);
        if (multiSelected) {
          onMultiDragEnd(deltaDays);
        } else {
          if (deltaDays === 0) {
            setLocalX(card.left);
            return;
          }
          onMove(card, deltaDays);
        }
      }}
      onResizeStart={() => {
        if (card.isUnscheduled) return;
        setContextMenuPos(null);
        lockScroll();
        const startIdx = Math.round((card.start - axisMinT) / DAY_MS);
        const endIdx = Math.max(startIdx, Math.round((card.end - axisMinT) / DAY_MS));
        resizeStartRef.current = { startIdx, endIdx };
      }}
      onResizeStop={(_event, direction, _ref, delta) => {
        if (card.isUnscheduled) return;
        const start = resizeStartRef.current;
        resizeStartRef.current = null;
        unlockScroll();
        if (!start) return;
        const deltaDays = Math.round(delta.width / safePxPerDay);
        const nextStartIdx = direction.includes("left")
          ? Math.min(start.endIdx, start.startIdx - deltaDays)
          : start.startIdx;
        const nextEndIdx = direction.includes("left")
          ? start.endIdx
          : Math.max(start.startIdx, start.endIdx + deltaDays);
        const nextStart = axisMinT + nextStartIdx * DAY_MS;
        const nextEnd = axisMinT + nextEndIdx * DAY_MS;
        setLocalX(Math.round(nextStartIdx * safePxPerDay));
        setLocalW(Math.max(safePxPerDay, (nextEndIdx - nextStartIdx + 1) * safePxPerDay));
        onResize(card, nextStart, nextEnd);
      }}
      onMouseDown={handleRndMouseDown}
      onContextMenu={handleContextMenu}
      style={{ position: "absolute" }}
      className={[
        "group select-none overflow-visible rounded-xl border-2 shadow-sm transition-[border-color,box-shadow,opacity] hover:shadow-md",
        card.isUnscheduled ? "opacity-55 hover:opacity-100" : "",
        selected || multiSelected
          ? card.isUnscheduled
            ? "border-blue-500 ring-2 ring-blue-200 dark:ring-blue-500/40"
            : "border-white ring-2 ring-blue-500"
          : card.isUnscheduled
            ? "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600"
            : "border-transparent hover:border-white/40",
      ].join(" ")}
    >
      <div
        className={[
          "relative h-full w-full overflow-hidden rounded-[10px]",
          "cursor-move",
          card.isUnscheduled ? "bg-white dark:bg-zinc-950" : "",
        ].join(" ")}
        style={card.isUnscheduled ? undefined : { background: card.color }}
        onMouseDown={handleCardMouseDown}
        onContextMenu={handleContextMenu}
        onMouseEnter={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const placeAbove = rect.top > window.innerHeight - rect.bottom;
          setTipPos({
            top: placeAbove ? rect.top - 6 : rect.bottom + 6,
            // 카드 시작점이 아니라 마우스 X 좌표 기준으로 툴팁 위치 설정.
            left: Math.max(8, Math.min(e.clientX, window.innerWidth - 268)),
            placeAbove,
          });
        }}
        onMouseLeave={() => setTipPos(null)}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(card);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onOpenPeek(card.pageId);
        }}
      >
        <TimelineCardText
          cardLeft={visualX}
          cardWidth={localW}
          contentOffset={contentOffset}
          title={card.title}
          titleClassName={titleClassName}
          dateLabel={card.showDateLabel ? card.dateLabel : undefined}
          dateClassName={dateClassName}
          containerClassName="flex h-full min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap px-2 pr-16 text-sm"
        >
          <TimelineCardPropertyLabels
            databaseId={databaseId}
            pageId={card.row.pageId}
            excludeColumnIds={excludeColumnIds}
            viewConfigs={viewConfigs}
            className="ml-0.5 text-xs"
            textClassName={labelTextClassName}
          />
        </TimelineCardText>
        <div className="absolute -right-7 top-1/2 z-20 flex -translate-y-1/2 items-center gap-0.5 rounded bg-white/90 opacity-0 backdrop-blur-sm group-hover:opacity-100 dark:bg-zinc-900/90">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenPeek(card.pageId);
            }}
            title="사이드 피크 열기"
            className="rounded p-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800"
          >
            <PanelRight size={11} />
          </button>
        </div>
      </div>
    </Rnd>
    {tipPos && !card.isUnscheduled &&
      createPortal(
        <div
          className="pointer-events-none fixed z-[320] max-w-[260px] rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          style={{
            top: tipPos.top,
            left: tipPos.left,
            transform: tipPos.placeAbove ? "translateY(-100%)" : undefined,
          }}
        >
          <div className="mb-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
            {card.columnName} · {card.dateLabel}
          </div>
          <div className="font-semibold text-zinc-900 dark:text-zinc-100">
            {card.title || "제목 없음"}
          </div>
          <ScheduleCardDetailRows
            databaseId={databaseId}
            pageId={card.row.pageId}
            excludeColumnIds={excludeColumnIds}
            viewConfigs={viewConfigs}
          />
        </div>,
        document.body,
      )}
    {contextMenuPos && !card.isUnscheduled &&
      createPortal(
        <ContextMenu
          x={contextMenuPos.left}
          y={contextMenuPos.top}
          currentColor={card.color}
          onColorChange={(color) => onColorChange(card, color)}
          onClose={() => setContextMenuPos(null)}
        />,
        document.body,
      )}
    </>
  );
}
