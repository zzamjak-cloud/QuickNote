/* eslint-disable react-hooks/purity -- 축/오늘 기준선은 렌더 시각의 Date.now() 사용 */
 
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { ChevronLeft, ChevronRight, PanelRight, Plus, X, ZoomIn, ZoomOut } from "lucide-react";
import { Rnd } from "react-rnd";
import type {
  ColumnDef,
  DatabasePanelState,
  DatabaseRowView,
} from "../../../types/database";
import { getVisibleOrderedColumns } from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useProcessedRows } from "../useProcessedRows";
import { useUiStore } from "../../../store/uiStore";
import { SimpleConfirmDialog } from "../../ui/SimpleConfirmDialog";
import {
  DAY_MS,
  TIMELINE_WEEK_CAL_DAYS as WEEK_CAL_DAYS,
  TIMELINE_WEEK_RANGE_DAYS as WEEK_RANGE_DAYS,
  timelineClampToWeekday as clampToWeekday,
  timelineGetRange as getRange,
  timelineStartOfDay as startOfDay,
  timelineStartOfWeekMon as startOfWeekMon,
  timelineWeekLabel as weekLabel,
  timelineWeekdayIndex as weekdayIndex,
} from "../../../lib/database/timelineGeometry";
import { useWindowedRows } from "./useWindowedRows";
import {
  DatabaseCellDisplay,
} from "../DatabaseCellDisplay";
import { databaseCellHasDisplayValue } from "../databaseCellDisplayUtils";

type Props = {
  databaseId: string;
  panelState: DatabasePanelState;
  setPanelState: (p: Partial<DatabasePanelState>) => void;
  /** 표시할 최대 행 수. 미지정 시 전체 표시. */
  visibleRowLimit?: number;
};

type Granularity = "month" | "day" | "week" | "range";

const ROW_HEIGHT = 32;
const ROW_GAP = 4;
const HEADER_HEIGHT = 36;
const SIDE_LABEL_W = 160;
const SIDE_LABEL_W_MIN = 120;
const SIDE_LABEL_W_MAX = 360;
const CELL_WIDTH_MIN = 12;
const CELL_WIDTH_MAX = 200;
const CELL_WIDTH_STEP = 8;
const CELL_WIDTH_DEFAULT = 100;
const LS_ZOOM_KEY = "quicknote.timeline.zoom";
const LS_GRANULARITY_KEY = "quicknote.timeline.granularity";
const LS_RANGE_START_KEY = "quicknote.timeline.rangeStart";
const LS_RANGE_END_KEY = "quicknote.timeline.rangeEnd";
const LS_MONTH_KEY = "quicknote.timeline.month";
const DRAG_ACTIVATE_PX = 3;
const UNSCHEDULED_CARD_LEFT = 8;
const UNSCHEDULED_CARD_WIDTH = 168;

const fmtDate = (ts: number) => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

const toDateIso = (ms: number) => {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const parseDateInput = (value: string): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  return startOfDay(new Date(Number(y), Number(m) - 1, Number(d)).getTime());
};

const startOfMonth = (t: number) => {
  const d = new Date(t);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const addMonths = (t: number, delta: number) => {
  const d = new Date(t);
  d.setMonth(d.getMonth() + delta, 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const endOfMonth = (t: number) => addMonths(startOfMonth(t), 1) - DAY_MS;

const monthInputToStart = (value: string): number | null => {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m] = match;
  return startOfMonth(new Date(Number(y), Number(m) - 1, 1).getTime());
};

const monthLabel = (monthStart: number) => {
  const d = new Date(monthStart);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
};

const rangeBucketDays = (totalDays: number): number => {
  if (totalDays <= 35) return 7;
  if (totalDays <= 120) return 10;
  if (totalDays <= 240) return 15;
  if (totalDays <= 370) return 30;
  if (totalDays <= 730) return 60;
  return 90;
};

const buildRangeBuckets = (totalDays: number, bucketDays: number): { offset: number; days: number }[] => {
  const buckets: { offset: number; days: number }[] = [];
  let offset = 0;
  while (offset < totalDays) {
    let days = Math.min(bucketDays, totalDays - offset);
    const remaining = totalDays - offset - days;
    if (remaining > 0 && remaining < Math.ceil(bucketDays / 2)) {
      days += remaining;
    }
    buckets.push({ offset, days });
    offset += days;
  }
  return buckets;
};

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "button, input, textarea, select, [contenteditable='true'], [role='textbox'], [data-db-timeline-card='true']",
    ),
  );
}

function rectsIntersect(
  selLeft: number,
  selRight: number,
  selTop: number,
  selBottom: number,
  cardLeft: number,
  cardRight: number,
  cardTop: number,
  cardBottom: number,
): boolean {
  return cardLeft < selRight && cardRight > selLeft && cardTop < selBottom && cardBottom > selTop;
}

type TimelineBoxRect = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

type TimelineCardLayout = {
  row: DatabaseRowView;
  pageId: string;
  start: number;
  end: number;
  left: number;
  width: number;
  top: number;
  dateLabel: string;
  tooltipText: string;
  isUnscheduled?: boolean;
};

// props 얕은 비교: row/isSelected 변경 시만 리렌더. 다른 행 선택·카드 드래그는 이 행에 영향 없음.
const TimelineLabelRow = memo(function TimelineLabelRow({
  row,
  isSelected,
  onFocus,
  openPeek,
}: {
  row: DatabaseRowView;
  isSelected: boolean;
  onFocus: (pageId: string) => void;
  openPeek: (pageId: string) => void;
}) {
  return (
    <div
      onClick={() => onFocus(row.pageId)}
      className={[
        "group relative flex cursor-pointer items-center gap-1 border-b border-zinc-100 px-2 pr-8 dark:border-zinc-800",
        isSelected
          ? "bg-blue-50 dark:bg-blue-950/30"
          : "hover:bg-zinc-50 dark:hover:bg-zinc-900",
      ].join(" ")}
      style={{ height: ROW_HEIGHT + ROW_GAP }}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onFocus(row.pageId);
        }
      }}
    >
      <span className="min-w-0 flex-1 truncate text-base text-zinc-700 dark:text-zinc-200">
        {row.title || "제목 없음"}
      </span>
      <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center rounded bg-white/90 opacity-0 backdrop-blur-sm group-hover:opacity-100 dark:bg-zinc-950/90">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); openPeek(row.pageId); }}
          title="피커뷰 보기"
          className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
        >
          <PanelRight size={12} />
        </button>
      </div>
    </div>
  );
});

export function DatabaseTimelineView({
  databaseId,
  panelState,
  setPanelState: _setPanelState,
  visibleRowLimit,
}: Props) {
  const { bundle, rows: allRows, columns } = useProcessedRows(databaseId, panelState);
  // 표시 제한이 있으면 slice 적용.
  const rows = visibleRowLimit != null ? allRows.slice(0, visibleRowLimit) : allRows;
  const virtualRows = useWindowedRows({
    count: rows.length,
    estimateSize: ROW_HEIGHT + ROW_GAP,
    enabled: visibleRowLimit == null && rows.length > 120,
    overscan: 10,
  });
  const renderedRows = virtualRows.enabled
    ? rows.slice(virtualRows.start, virtualRows.end)
    : rows;
  const totalRowsHeight = rows.length * (ROW_HEIGHT + ROW_GAP);
  const addRow = useDatabaseStore((s) => s.addRow);
  const deleteRow = useDatabaseStore((s) => s.deleteRow);
  const updateCell = useDatabaseStore((s) => s.updateCell);
  const openPeek = useUiStore((s) => s.openPeek);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [granularity, setGranularity] = useState<Granularity>(() => {
    const saved = localStorage.getItem(LS_GRANULARITY_KEY);
    return saved === "month" || saved === "week" || saved === "range" ? saved : "day";
  });
  const [rangeStartInput, setRangeStartInput] = useState(() =>
    localStorage.getItem(LS_RANGE_START_KEY) ?? "",
  );
  const [rangeEndInput, setRangeEndInput] = useState(() =>
    localStorage.getItem(LS_RANGE_END_KEY) ?? "",
  );
  const [visibleMonthStart, setVisibleMonthStart] = useState(() => {
    const saved = localStorage.getItem(LS_MONTH_KEY);
    return monthInputToStart(saved ?? "") ?? startOfMonth(Date.now());
  });

  useEffect(() => {
    localStorage.setItem(LS_GRANULARITY_KEY, granularity);
  }, [granularity]);
  useEffect(() => {
    if (rangeStartInput) {
      localStorage.setItem(LS_RANGE_START_KEY, rangeStartInput);
    } else {
      localStorage.removeItem(LS_RANGE_START_KEY);
    }
  }, [rangeStartInput]);
  useEffect(() => {
    if (rangeEndInput) {
      localStorage.setItem(LS_RANGE_END_KEY, rangeEndInput);
    } else {
      localStorage.removeItem(LS_RANGE_END_KEY);
    }
  }, [rangeEndInput]);
  useEffect(() => {
    localStorage.setItem(LS_MONTH_KEY, toDateIso(visibleMonthStart).slice(0, 7));
  }, [visibleMonthStart]);

  const [cellWidthOverride, setCellWidthOverride] = useState(() => {
    const saved = localStorage.getItem(LS_ZOOM_KEY);
    const n = saved ? parseInt(saved, 10) : NaN;
    return Number.isFinite(n) && n >= CELL_WIDTH_MIN && n <= CELL_WIDTH_MAX ? n : CELL_WIDTH_DEFAULT;
  });

  useEffect(() => {
    localStorage.setItem(LS_ZOOM_KEY, String(cellWidthOverride));
  }, [cellWidthOverride]);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [trackPxWidth, setTrackPxWidth] = useState(0);
  const [sideLabelWidth, setSideLabelWidth] = useState(SIDE_LABEL_W);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setTrackPxWidth(el.clientWidth);
    });
    ro.observe(el);
    setTrackPxWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [granularity, rangeEndInput, rangeStartInput]);
  const onSideLabelResizeStart = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = sideLabelWidth;
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(
        SIDE_LABEL_W_MIN,
        Math.min(SIDE_LABEL_W_MAX, startW + (ev.clientX - startX)),
      );
      setSideLabelWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
  }, [sideLabelWidth]);

  const [rowDeletePageId, setRowDeletePageId] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [selectionRect, setSelectionRect] = useState<TimelineBoxRect | null>(null);
  const selectionRectRef = useRef<TimelineBoxRect | null>(null);
  const boxSelectingRef = useRef(false);
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const [isMultiDragging, setIsMultiDragging] = useState(false);
  const [multiDragDeltaX, setMultiDragDeltaX] = useState(0);
  const scrollLockLeftRef = useRef<number | null>(null);

  const dateCols = columns.filter((c) => c.type === "date");
  const dateColId =
    panelState.timelineDateColumnId ?? dateCols[0]?.id ?? null;

  const labelCols = useMemo(() => {
    const titleCol = columns.find((c) => c.type === "title");
    const v = getVisibleOrderedColumns(columns, "timeline", panelState.viewConfigs);
    if (panelState.viewConfigs?.timeline?.visibleColumnIds) {
      return v.filter((c) => c.id !== titleCol?.id && c.id !== dateColId);
    }
    return columns
      .filter((c) => c.id !== titleCol?.id && c.id !== dateColId)
      .slice(0, 1);
  }, [columns, panelState.viewConfigs, dateColId]);

  const dateRanges = useMemo(() => {
    if (!dateColId) return [] as { row: DatabaseRowView; start: number; end: number }[];
    const out: { row: DatabaseRowView; start: number; end: number }[] = [];
    for (const r of rows) {
      const range = getRange(r.cells[dateColId]);
      if (range) out.push({ row: r, ...range });
    }
    return out;
  }, [rows, dateColId]);

  const customRange = useMemo(() => {
    const start = parseDateInput(rangeStartInput);
    const end = parseDateInput(rangeEndInput);
    if (start == null || end == null) return null;
    return {
      start: Math.min(start, end),
      end: Math.max(start, end),
    };
  }, [rangeEndInput, rangeStartInput]);
  const fallbackRange = useMemo(() => ({
    start: startOfMonth(Date.now()),
    end: endOfMonth(Date.now()),
  }), []);
  const isRangeAxis = granularity === "range";
  const effectiveRange = isRangeAxis ? (customRange ?? fallbackRange) : null;
  const isWeekAxis = granularity === "week" && !isRangeAxis;
  const isMonthAxis = granularity === "month" && !isRangeAxis;
  const usesScrollableAxis = granularity === "day" && !isRangeAxis;
  const usesFitAxis = !usesScrollableAxis;

  const axis = useMemo(() => {
    if (effectiveRange) {
      const totalDays = Math.max(1, Math.round((effectiveRange.end - effectiveRange.start) / DAY_MS) + 1);
      return {
        minT: effectiveRange.start,
        maxT: effectiveRange.end,
        totalDays,
        cellWidth: 0,
        totalW: 0,
      };
    }
    if (granularity === "week") {
      const thisWeekStart = startOfWeekMon(Date.now());
      const minT = thisWeekStart - WEEK_CAL_DAYS * DAY_MS;
      const maxT = minT + (2 * WEEK_CAL_DAYS + 4) * DAY_MS;
      const totalDays = WEEK_RANGE_DAYS;
      return { minT, maxT, totalDays, cellWidth: 0, totalW: 0 };
    }
    let minT: number;
    let maxT: number;
    if (granularity === "month") {
      minT = visibleMonthStart;
      maxT = endOfMonth(visibleMonthStart);
    } else if (dateRanges.length === 0) {
      const today = startOfDay(Date.now());
      minT = today - 14 * DAY_MS;
      maxT = today + 14 * DAY_MS;
    } else {
      minT = Math.min(...dateRanges.map((r) => r.start)) - 7 * DAY_MS;
      maxT = Math.max(...dateRanges.map((r) => r.end)) + 7 * DAY_MS;
    }
    const totalDays = Math.max(1, Math.round((maxT - minT) / DAY_MS) + 1);
    const cellWidth = granularity === "month" ? 0 : cellWidthOverride;
    const totalW = totalDays * cellWidth;
    return { minT, maxT, totalDays, cellWidth, totalW };
  }, [cellWidthOverride, dateRanges, effectiveRange, granularity, visibleMonthStart]);

  const pxPerDay =
    isWeekAxis
      ? trackPxWidth / WEEK_RANGE_DAYS
      : usesFitAxis
        ? trackPxWidth / axis.totalDays
        : axis.cellWidth;

  const dayToX = useCallback((t: number): number => {
    if (isWeekAxis) {
      const idx = weekdayIndex(t, axis.minT);
      if (idx < 0) return 0;
      return Math.round(idx * pxPerDay);
    }
    return Math.round(((t - axis.minT) / DAY_MS) * pxPerDay);
  }, [axis.minT, isWeekAxis, pxPerDay]);

  const dayWidth = useCallback((start: number, end: number): number => {
    if (isWeekAxis) {
      const sIdx = weekdayIndex(start, axis.minT);
      const eIdx = weekdayIndex(end, axis.minT);
      if (sIdx < 0 || eIdx < 0) return pxPerDay;
      const days = eIdx - sIdx + 1;
      return Math.max(pxPerDay, days * pxPerDay);
    }
    const days = Math.round((end - start) / DAY_MS) + 1;
    return Math.max(pxPerDay, days * pxPerDay);
  }, [axis.minT, isWeekAxis, pxPerDay]);

  type HeaderTick = {
    x: number;
    label: string;
    major?: boolean;
    width?: number;
    widthPct?: number;
    align?: "left" | "center";
  };
  const headerTicks: HeaderTick[] = [];
  const weekendStrips: { x: number }[] = [];
  if (isWeekAxis) {
    const labels = ["지난 주", "이번 주", "다음 주"];
    for (let i = 0; i < 3; i++) {
      const wkStart = axis.minT + i * WEEK_CAL_DAYS * DAY_MS;
      headerTicks.push({
        x: 0,
        label: `${labels[i]} (${weekLabel(wkStart)})`,
        major: i === 1,
        widthPct: 100 / 3,
      });
    }
  } else if (isRangeAxis && effectiveRange) {
    const bucketDays = rangeBucketDays(axis.totalDays);
    for (const bucket of buildRangeBuckets(axis.totalDays, bucketDays)) {
      const offset = bucket.offset;
      const bucketStart = axis.minT + offset * DAY_MS;
      const bucketEnd = Math.min(axis.maxT, bucketStart + (bucket.days - 1) * DAY_MS);
      const x = trackPxWidth > 0 ? (offset / axis.totalDays) * trackPxWidth : dayToX(bucketStart);
      const rawWidth = trackPxWidth > 0
        ? (bucket.days / axis.totalDays) * trackPxWidth
        : dayWidth(bucketStart, bucketEnd);
      const width = Math.max(1, Math.min(rawWidth, Math.max(0, trackPxWidth - x)));
      headerTicks.push({
        x,
        label: fmtDate(bucketStart),
        major: offset === 0,
        align: "left",
        width,
      });
    }
  } else if (isMonthAxis) {
    for (let i = 0; i < axis.totalDays; i++) {
      const t = axis.minT + i * DAY_MS;
      const d = new Date(t);
      const dow = d.getDay();
      headerTicks.push({
        x: dayToX(t),
        label: String(d.getDate()),
        major: d.getDate() === 1 || dow === 1,
        width: Math.max(1, pxPerDay),
      });
      if (dow === 0 || dow === 6) {
        weekendStrips.push({ x: dayToX(t) });
      }
    }
  } else {
    for (let i = 0; i < axis.totalDays; i++) {
      const t = axis.minT + i * DAY_MS;
      const d = new Date(t);
      const dow = d.getDay();
      headerTicks.push({
        x: i * axis.cellWidth,
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        major: d.getDate() === 1,
      });
      if (dow === 0 || dow === 6) {
        weekendStrips.push({ x: i * axis.cellWidth });
      }
    }
  }

  const todayX =
    isWeekAxis
      ? (() => {
          const idx = weekdayIndex(Date.now(), axis.minT);
          if (idx < 0 || !Number.isFinite(pxPerDay) || pxPerDay <= 0) return -1;
          return Math.round(idx * pxPerDay);
        })()
      : dayToX(startOfDay(Date.now()));

  const cardLayouts = useMemo<TimelineCardLayout[]>(() => {
    if (!dateColId) return [];
    if (usesFitAxis && (!Number.isFinite(pxPerDay) || pxPerDay <= 0)) return [];
    const layouts: TimelineCardLayout[] = [];
    const trackWidth = usesScrollableAxis ? axis.totalW : trackPxWidth;
    const unscheduledWidth = Math.max(
      96,
      Math.min(
        UNSCHEDULED_CARD_WIDTH,
        trackWidth > 0
          ? Math.max(96, trackWidth - UNSCHEDULED_CARD_LEFT - 8)
          : UNSCHEDULED_CARD_WIDTH,
      ),
    );
    for (const [localIdx, row] of renderedRows.entries()) {
      const rIdx = virtualRows.start + localIdx;
      const range = getRange(row.cells[dateColId]);
      if (!range) {
        const dateLabel = "날짜 없음";
        layouts.push({
          row,
          pageId: row.pageId,
          start: axis.minT,
          end: axis.minT,
          left: UNSCHEDULED_CARD_LEFT,
          width: unscheduledWidth,
          top: rIdx * (ROW_HEIGHT + ROW_GAP) + 2,
          dateLabel,
          tooltipText: `${row.title || "제목 없음"} (${dateLabel})`,
          isUnscheduled: true,
        });
        continue;
      }
      let visStart = Math.max(range.start, axis.minT);
      let visEnd = Math.min(range.end, axis.maxT);
      if (visEnd < axis.minT || visStart > axis.maxT) continue;
      if (isWeekAxis) {
        const clamped = clampToWeekday(visStart, visEnd);
        if (!clamped) continue;
        visStart = clamped.start;
        visEnd = clamped.end;
      }
      const left = dayToX(visStart);
      const width = Math.max(dayWidth(visStart, visEnd), 24);
      const dateLabel = `${fmtDate(range.start)} ~ ${fmtDate(range.end)}`;
      layouts.push({
        row,
        pageId: row.pageId,
        start: visStart,
        end: visEnd,
        left,
        width,
        top: rIdx * (ROW_HEIGHT + ROW_GAP) + 2,
        dateLabel,
        tooltipText: `${row.title || "제목 없음"} (${dateLabel})`,
      });
    }
    return layouts;
  }, [
    axis.maxT,
    axis.minT,
    axis.totalW,
    dateColId,
    dayToX,
    dayWidth,
    isWeekAxis,
    pxPerDay,
    renderedRows,
    trackPxWidth,
    usesFitAxis,
    usesScrollableAxis,
    virtualRows.start,
  ]);

  const getCardsInRect = useCallback(
    (rect: TimelineBoxRect) => {
      const left = Math.min(rect.startX, rect.endX);
      const right = Math.max(rect.startX, rect.endX);
      const top = Math.min(rect.startY, rect.endY);
      const bottom = Math.max(rect.startY, rect.endY);
      const next = new Set<string>();
      for (const card of cardLayouts) {
        if (
          rectsIntersect(
            left,
            right,
            top,
            bottom,
            card.left,
            card.left + card.width,
            card.top,
            card.top + ROW_HEIGHT - 4,
          )
        ) {
          next.add(card.pageId);
        }
      }
      return next;
    },
    [cardLayouts],
  );

  useEffect(() => {
    const pageIds = new Set(rows.map((row) => row.pageId));
    if (selectedPageId && !pageIds.has(selectedPageId)) {
      setSelectedPageId(null);
    }
    setSelectedCardIds((prev) => {
      const next = new Set(Array.from(prev).filter((id) => pageIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows, selectedPageId]);

  const scrollToToday = useCallback(() => {
    if (isMonthAxis) {
      setVisibleMonthStart(startOfMonth(Date.now()));
      return;
    }
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, todayX - el.clientWidth / 2);
  }, [isMonthAxis, todayX]);

  const focusTimelineCard = useCallback((pageId: string) => {
    setSelectedPageId(pageId);
    setSelectedCardIds(new Set());
    // 월 축은 visibleMonthStart 가 속한 달의 항목만 렌더한다.
    // 다른 달 항목을 클릭하면 해당 항목 시작일의 달로 먼저 전환해야 카드가 보인다.
    if (isMonthAxis) {
      const row = dateColId ? rows.find((item) => item.pageId === pageId) : null;
      const range = row && dateColId ? getRange(row.cells[dateColId]) : null;
      if (range) {
        const targetMonth = startOfMonth(range.start);
        setVisibleMonthStart((prev) => (prev === targetMonth ? prev : targetMonth));
      }
      return;
    }
    if (!usesScrollableAxis) return;
    const card = cardLayouts.find((item) => item.pageId === pageId);
    const el = scrollContainerRef.current;
    if (!card || !el) return;
    const visibleTrackWidth = Math.max(1, el.clientWidth - sideLabelWidth);
    const nextLeft = Math.max(
      0,
      card.left - (visibleTrackWidth - card.width) / 2,
    );
    el.scrollTo({ left: nextLeft, behavior: "smooth" });
  }, [cardLayouts, dateColId, isMonthAxis, rows, sideLabelWidth, usesScrollableAxis]);

  const commitRange = useCallback(
    (pageId: string, start: number, end: number) => {
      if (!dateColId) return;
      updateCell(databaseId, pageId, dateColId, {
        start: toDateIso(start),
        end: toDateIso(end),
      });
    },
    [databaseId, dateColId, updateCell],
  );

  const moveCardsByDays = useCallback(
    (pageIds: Iterable<string>, deltaDays: number) => {
      if (!dateColId || deltaDays === 0) return;
      const deltaMs = deltaDays * DAY_MS;
      for (const pageId of pageIds) {
        const row = rows.find((item) => item.pageId === pageId);
        if (!row) continue;
        const range = getRange(row.cells[dateColId]);
        if (!range) continue;
        commitRange(pageId, range.start + deltaMs, range.end + deltaMs);
      }
    },
    [commitRange, dateColId, rows],
  );

  const selectCard = useCallback((pageId: string) => {
    setSelectedPageId(pageId);
    setSelectedCardIds((prev) => (prev.has(pageId) ? prev : new Set()));
  }, []);

  const openPageFromKeyboard = useCallback(() => {
    if (!selectedPageId) return;
    openPeek(selectedPageId);
  }, [openPeek, selectedPageId]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isInteractiveTarget(event.target)) return;
      if (event.key === "Escape" && selectedCardIds.size > 0) {
        setSelectedCardIds(new Set());
        return;
      }
      if (!selectedPageId) return;
      if (event.key === "Enter") {
        event.preventDefault();
        openPageFromKeyboard();
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        setRowDeletePageId(selectedPageId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openPageFromKeyboard, selectedCardIds.size, selectedPageId]);

  const pointFromEvent = useCallback((event: { clientX: number; clientY: number }) => {
    const track = trackRef.current;
    if (!track) return null;
    const rect = track.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }, []);

  const beginBoxSelection = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isInteractiveTarget(event.target)) return;
      const track = trackRef.current;
      if (!track || !(event.target instanceof Node) || !track.contains(event.target)) return;
      const point = pointFromEvent(event);
      if (!point) return;
      event.preventDefault();
      const next: TimelineBoxRect = {
        startX: point.x,
        startY: point.y,
        endX: point.x,
        endY: point.y,
      };
      selectionRectRef.current = next;
      boxSelectingRef.current = true;
      setSelectionRect(next);
      setSelectedCardIds(new Set());
      setSelectedPageId(null);
      setIsBoxSelecting(true);
    },
    [pointFromEvent],
  );

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!boxSelectingRef.current) return;
      const point = pointFromEvent(event);
      if (!point) return;
      const next: TimelineBoxRect = {
        startX: selectionRectRef.current?.startX ?? point.x,
        startY: selectionRectRef.current?.startY ?? point.y,
        endX: point.x,
        endY: point.y,
      };
      selectionRectRef.current = next;
      setSelectionRect(next);
      setSelectedCardIds(getCardsInRect(next));
    };
    const onUp = () => {
      if (!boxSelectingRef.current) return;
      const finalRect = selectionRectRef.current;
      setSelectedCardIds(finalRect ? getCardsInRect(finalRect) : new Set());
      boxSelectingRef.current = false;
      selectionRectRef.current = null;
      setSelectionRect(null);
      setIsBoxSelecting(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [getCardsInRect, pointFromEvent]);

  const lockTimelineScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    scrollLockLeftRef.current = el?.scrollLeft ?? null;
  }, []);

  const unlockTimelineScroll = useCallback(() => {
    scrollLockLeftRef.current = null;
  }, []);

  const handleTimelineScroll = useCallback(() => {
    const locked = scrollLockLeftRef.current;
    const el = scrollContainerRef.current;
    if (locked == null || !el) return;
    if (el.scrollLeft !== locked) el.scrollLeft = locked;
  }, []);

  if (!bundle) return null;

  return (
    <div className="select-none pt-3">
      {/* 컨트롤 바 */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <div className="inline-flex overflow-hidden rounded border border-zinc-300 dark:border-zinc-600">
          {(["month", "day", "week", "range"] as Granularity[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGranularity(g)}
              className={[
                "px-2 py-1 text-sm",
                granularity === g
                  ? "bg-blue-500 text-white"
                  : "bg-white text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
              ].join(" ")}
            >
              {g === "month" ? "월" : g === "day" ? "일" : g === "week" ? "주" : "범위"}
            </button>
          ))}
        </div>
        {isMonthAxis && (
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => setVisibleMonthStart((prev) => addMonths(prev, -1))}
              className="flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              title="이전 월"
              aria-label="이전 월"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="min-w-[7.5rem] text-center text-sm font-medium text-zinc-700 dark:text-zinc-200">
              {monthLabel(visibleMonthStart)}
            </span>
            <button
              type="button"
              onClick={() => setVisibleMonthStart((prev) => addMonths(prev, 1))}
              className="flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              title="다음 월"
              aria-label="다음 월"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        )}
        {isRangeAxis && (
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={rangeStartInput}
              onChange={(event) => setRangeStartInput(event.target.value)}
              className="h-7 w-[8.6rem] border-b border-zinc-200 bg-transparent px-1 text-sm text-zinc-700 outline-none focus:border-blue-400 dark:border-zinc-700 dark:text-zinc-200"
              aria-label="타임라인 범위 시작일"
            />
            <span className="text-zinc-400">~</span>
            <input
              type="date"
              value={rangeEndInput}
              onChange={(event) => setRangeEndInput(event.target.value)}
              className="h-7 w-[8.6rem] border-b border-zinc-200 bg-transparent px-1 text-sm text-zinc-700 outline-none focus:border-blue-400 dark:border-zinc-700 dark:text-zinc-200"
              aria-label="타임라인 범위 종료일"
            />
            {(rangeStartInput || rangeEndInput) && (
              <button
                type="button"
                onClick={() => {
                  setRangeStartInput("");
                  setRangeEndInput("");
                }}
                className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                title="범위 초기화"
                aria-label="범위 초기화"
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}
        {/* 일 모드 전용 오늘 이동 + 셀 너비 줌 컨트롤 */}
        {!isWeekAxis && !isRangeAxis && (
          <>
            <button
              type="button"
              onClick={scrollToToday}
              className="ml-auto rounded px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              오늘
            </button>
            {granularity === "day" && (
            <div className="inline-flex items-center gap-1 rounded border border-zinc-300 px-1 dark:border-zinc-600">
            <button
              type="button"
              onClick={() => setCellWidthOverride((w) => Math.max(CELL_WIDTH_MIN, w - CELL_WIDTH_STEP))}
              disabled={cellWidthOverride <= CELL_WIDTH_MIN}
              title="축소"
              className="rounded p-0.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
            >
              <ZoomOut size={13} />
            </button>
            <span className="min-w-[2.5rem] text-center text-sm text-zinc-500">{cellWidthOverride}px</span>
            <button
              type="button"
              onClick={() => setCellWidthOverride((w) => Math.min(CELL_WIDTH_MAX, w + CELL_WIDTH_STEP))}
              disabled={cellWidthOverride >= CELL_WIDTH_MAX}
              title="확대"
              className="rounded p-0.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
            >
              <ZoomIn size={13} />
            </button>
            </div>
            )}
          </>
        )}
      </div>

      {!dateColId ? (
        <p className="py-6 text-center text-xs text-zinc-500">
          날짜 타입 속성을 추가한 뒤 타임라인 축으로 지정하세요.
        </p>
      ) : (
        <div
          ref={scrollContainerRef}
          onMouseDown={beginBoxSelection}
          onScroll={handleTimelineScroll}
          className={[
            "rounded border border-zinc-200 dark:border-zinc-700",
            usesScrollableAxis ? "overflow-x-auto" : "overflow-hidden",
          ].join(" ")}
        >
          <div
            className="relative"
            style={{
              width:
                usesScrollableAxis
                  ? sideLabelWidth + axis.totalW
                  : "100%",
              minHeight:
                HEADER_HEIGHT + (rows.length || 1) * (ROW_HEIGHT + ROW_GAP) + 16,
            }}
          >
            {/* 헤더 */}
            <div
              className="sticky top-0 z-10 flex border-b border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950"
              style={{ height: HEADER_HEIGHT }}
            >
              <div
                className="sticky left-0 z-[11] shrink-0 border-r border-zinc-200 bg-white px-2 py-2 text-xs uppercase text-zinc-400 dark:border-zinc-700 dark:bg-zinc-950"
                style={{ width: sideLabelWidth }}
              >
                항목
              </div>
              {isWeekAxis ? (
                <div className="relative flex flex-1">
                  {headerTicks.map((t, i) => (
                    <div
                      key={i}
                      className={[
                        "flex flex-1 items-center justify-center border-l text-xs truncate px-2",
                        t.major
                          ? "border-zinc-300 font-semibold text-zinc-800 dark:border-zinc-600 dark:text-zinc-100"
                          : "border-zinc-100 text-zinc-500 dark:border-zinc-800",
                      ].join(" ")}
                    >
                      {t.label}
                    </div>
                  ))}
                </div>
              ) : isMonthAxis || isRangeAxis ? (
                <div className="relative flex-1">
                  {headerTicks.map((t, i) => (
                    <div
                      key={i}
                      className={[
                        "absolute top-0 flex h-full items-center border-l px-1 text-xs",
                        t.align === "left" ? "justify-start" : "justify-center",
                        t.major
                          ? "border-zinc-300 font-semibold text-zinc-800 dark:border-zinc-600 dark:text-zinc-100"
                          : "border-zinc-100 text-zinc-500 dark:border-zinc-800",
                      ].join(" ")}
                      style={{ left: t.x, width: t.width }}
                    >
                      <span className="truncate">{t.label}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="relative" style={{ width: axis.totalW }}>
                  {headerTicks.map((t, i) => (
                    <div
                      key={i}
                      className={[
                        "absolute top-0 h-full text-xs",
                        t.major
                          ? "border-l border-zinc-300 font-medium text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
                          : "border-l border-zinc-100 text-zinc-400 dark:border-zinc-800",
                      ].join(" ")}
                      style={{ left: t.x, paddingLeft: 4 }}
                    >
                      {t.label}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 본문 */}
            <div ref={virtualRows.containerRef} className="flex">
              {/* 좌측 라벨 컬럼 — 수평 스크롤 시 고정 */}
              <div
                className="sticky left-0 z-[5] shrink-0 border-r border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950"
                style={{ width: sideLabelWidth }}
              >
                {virtualRows.topPadding > 0 && (
                  <div aria-hidden="true" style={{ height: virtualRows.topPadding }} />
                )}
                {renderedRows.map((row) => (
                  <TimelineLabelRow
                    key={row.pageId}
                    row={row}
                    isSelected={selectedPageId === row.pageId || selectedCardIds.has(row.pageId)}
                    onFocus={focusTimelineCard}
                    openPeek={openPeek}
                  />
                ))}
                {virtualRows.bottomPadding > 0 && (
                  <div aria-hidden="true" style={{ height: virtualRows.bottomPadding }} />
                )}
                <div
                  onMouseDown={onSideLabelResizeStart}
                  className="absolute right-0 top-0 z-20 h-full w-1.5 cursor-col-resize hover:bg-blue-400/60"
                  title="첫번째 컬럼 너비 조절"
                />
              </div>

              {/* 우측 트랙 + 카드 */}
              <div
                ref={trackRef}
                className="relative flex-1"
                style={
                  usesScrollableAxis
                    ? { width: axis.totalW, height: totalRowsHeight }
                    : { height: totalRowsHeight }
                }
              >
                {/* 주말 배경 */}
                {!isWeekAxis && weekendStrips.map((s, i) => (
                  <div
                    key={i}
                    className="absolute top-0 h-full bg-zinc-100 dark:bg-zinc-800/50"
                    style={{ left: s.x, width: usesScrollableAxis ? axis.cellWidth : pxPerDay }}
                  />
                ))}

                {/* 세로 그리드 라인 */}
                {!isWeekAxis
                  ? headerTicks.map((t, i) => (
                      <div
                        key={i}
                        className={[
                          "absolute top-0 h-full",
                          t.major
                            ? "border-l border-zinc-200 dark:border-zinc-700"
                            : "border-l border-zinc-100 dark:border-zinc-800",
                        ].join(" ")}
                        style={{ left: t.x }}
                      />
                    ))
                  : [0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className={[
                          "absolute top-0 h-full",
                          i === 1
                            ? "border-l border-zinc-200 dark:border-zinc-700"
                            : "border-l border-zinc-100 dark:border-zinc-800",
                        ].join(" ")}
                        style={{ left: `${(i * 100) / 3}%` }}
                      />
                    ))}

                {/* 오늘 마커 */}
                {todayX >= 0 && todayX <= (usesScrollableAxis ? axis.totalW : trackPxWidth) && (
                  <div
                    className="absolute top-0 z-[1] w-px bg-red-400/80"
                    style={{ left: todayX, height: totalRowsHeight }}
                  />
                )}

                {/* 행별 트랙 배경 */}
                {renderedRows.map((row, localIdx) => {
                  const rIdx = virtualRows.start + localIdx;
                  return (
                  <div
                    key={`track:${row.pageId}`}
                    className="absolute left-0 right-0 border-b border-zinc-100 dark:border-zinc-800"
                    style={{
                      top: rIdx * (ROW_HEIGHT + ROW_GAP),
                      height: ROW_HEIGHT + ROW_GAP,
                    }}
                  />
                  );
                })}

                {cardLayouts.map((card) => (
                  <DatabaseTimelineCard
                    key={card.pageId}
                    card={card}
                    labelCols={labelCols}
                    axisMinT={axis.minT}
                    pxPerDay={pxPerDay}
                    selected={selectedPageId === card.pageId}
                    multiSelected={selectedCardIds.has(card.pageId)}
                    multiDragDeltaX={
                      isMultiDragging && selectedCardIds.has(card.pageId)
                        ? multiDragDeltaX
                        : null
                    }
                    onSelect={selectCard}
                    onOpenPeek={openPeek}
                    onMove={(pageId, deltaDays) => moveCardsByDays([pageId], deltaDays)}
                    onResize={(pageId, start, end) => commitRange(pageId, start, end)}
                    onMultiDragStart={() => {
                      setIsMultiDragging(true);
                      setMultiDragDeltaX(0);
                    }}
                    onMultiDragMove={setMultiDragDeltaX}
                    onMultiDragEnd={(deltaDays) => {
                      setIsMultiDragging(false);
                      setMultiDragDeltaX(0);
                      moveCardsByDays(selectedCardIds, deltaDays);
                    }}
                    lockScroll={lockTimelineScroll}
                    unlockScroll={unlockTimelineScroll}
                  />
                ))}

                {isBoxSelecting && selectionRect && (
                  <div
                    className="pointer-events-none absolute z-[90] rounded-sm border-2 border-blue-400 bg-blue-400/15"
                    style={{
                      left: Math.min(selectionRect.startX, selectionRect.endX),
                      top: Math.min(selectionRect.startY, selectionRect.endY),
                      width: Math.abs(selectionRect.endX - selectionRect.startX),
                      height: Math.abs(selectionRect.endY - selectionRect.startY),
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => addRow(databaseId)}
        className="mt-3 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        <Plus size={14} /> 새 항목
      </button>
      <SimpleConfirmDialog
        open={rowDeletePageId !== null}
        title="행 삭제"
        message="이 행을 삭제할까요? (연결된 페이지도 삭제됩니다)"
        confirmLabel="삭제"
        danger
        onCancel={() => setRowDeletePageId(null)}
        onConfirm={() => {
          if (rowDeletePageId) {
            deleteRow(databaseId, rowDeletePageId);
            setSelectedPageId(null);
            setSelectedCardIds((prev) => {
              const next = new Set(prev);
              next.delete(rowDeletePageId);
              return next;
            });
          }
          setRowDeletePageId(null);
        }}
      />
    </div>
  );
}

function DatabaseTimelineCard({
  card,
  labelCols,
  axisMinT,
  pxPerDay,
  selected,
  multiSelected,
  multiDragDeltaX,
  onSelect,
  onOpenPeek,
  onMove,
  onResize,
  onMultiDragStart,
  onMultiDragMove,
  onMultiDragEnd,
  lockScroll,
  unlockScroll,
}: {
  card: TimelineCardLayout;
  labelCols: ColumnDef[];
  axisMinT: number;
  pxPerDay: number;
  selected: boolean;
  multiSelected: boolean;
  multiDragDeltaX: number | null;
  onSelect: (pageId: string) => void;
  onOpenPeek: (pageId: string) => void;
  onMove: (pageId: string, deltaDays: number) => void;
  onResize: (pageId: string, start: number, end: number) => void;
  onMultiDragStart: () => void;
  onMultiDragMove: (deltaX: number) => void;
  onMultiDragEnd: (deltaDays: number) => void;
  lockScroll: () => void;
  unlockScroll: () => void;
}) {
  const [localX, setLocalX] = useState(card.left);
  const [localW, setLocalW] = useState(card.width);
  const dragMovedRef = useRef(false);
  const resizeStartRef = useRef<{ startIdx: number; endIdx: number } | null>(null);

  useLayoutEffect(() => {
    setLocalX(card.left);
    setLocalW(card.width);
  }, [card.left, card.width]);

  const safePxPerDay = Math.max(pxPerDay, 1);
  const visualX =
    !card.isUnscheduled && multiDragDeltaX != null
      ? card.left + multiDragDeltaX
      : localX;
  const titleClassName = card.isUnscheduled
    ? "font-medium text-zinc-700 dark:text-zinc-200"
    : "font-medium text-white";
  const dateClassName = card.isUnscheduled
    ? "shrink-0 text-xs text-zinc-400 dark:text-zinc-500"
    : "shrink-0 text-xs text-green-200";
  const labelTextClassName = card.isUnscheduled
    ? "text-zinc-500 dark:text-zinc-400"
    : "text-green-100";
  const separatorClassName = card.isUnscheduled
    ? "shrink-0 text-zinc-300 dark:text-zinc-600"
    : "shrink-0 text-green-200";

  return (
    <Rnd
      data-db-timeline-card="true"
      title={card.tooltipText}
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
          onSelect(card.pageId);
          return;
        }
        if (card.isUnscheduled) {
          const startIdx = Math.max(0, Math.round(data.x / safePxPerDay));
          const start = axisMinT + startIdx * DAY_MS;
          setLocalX(card.left);
          onResize(card.pageId, start, start);
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
          onMove(card.pageId, deltaDays);
        }
      }}
      onResizeStart={() => {
        if (card.isUnscheduled) return;
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
        onResize(card.pageId, nextStart, nextEnd);
      }}
      style={{ position: "absolute" }}
      className={[
        "group select-none overflow-visible rounded-md border-2 shadow-sm transition-[border-color,box-shadow,opacity] hover:shadow-md",
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
              "relative h-full w-full overflow-hidden",
              "cursor-move",
              card.isUnscheduled ? "bg-white dark:bg-zinc-950" : "",
            ].join(" ")}
        style={card.isUnscheduled ? undefined : { background: "#16a34a" }}
        onMouseDown={() => onSelect(card.pageId)}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(card.pageId);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onOpenPeek(card.pageId);
        }}
      >
        <div className="flex h-full min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap px-2 pr-16 text-sm">
          <span className={titleClassName}>{card.row.title || "제목 없음"}</span>
          <span className={dateClassName}>{card.dateLabel}</span>
          {labelCols.some((c) => databaseCellHasDisplayValue(card.row.cells[c.id], c)) && (
            <span className="ml-0.5 flex min-w-0 items-center gap-1 overflow-hidden text-xs">
              {labelCols
                .filter((c) => databaseCellHasDisplayValue(card.row.cells[c.id], c))
                .map((c, idx) => (
                  <Fragment key={c.id}>
                    {idx > 0 && (
                      <span className={separatorClassName}>·</span>
                    )}
                    <span className="min-w-0 truncate">
                      <DatabaseCellDisplay
                        column={c}
                        value={card.row.cells[c.id]}
                        textClassName={labelTextClassName}
                      />
                    </span>
                  </Fragment>
                ))}
            </span>
          )}
        </div>
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
  );
}
