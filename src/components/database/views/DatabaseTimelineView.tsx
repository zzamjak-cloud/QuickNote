/* eslint-disable react-hooks/purity -- 축/오늘 기준선은 렌더 시각의 Date.now() 사용 */
 
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { PanelRight, Plus } from "lucide-react";
import { Rnd } from "react-rnd";
import { createPortal } from "react-dom";
import type {
  ColumnDef,
  DatabasePanelState,
  DatabaseRowView,
  TimelineDateCardConfig,
  ViewConfigsMap,
} from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useProcessedRows } from "../useProcessedRows";
import { resolveActiveFilterRules } from "../../../lib/databaseQuery";
import { SimpleConfirmDialog } from "../../ui/SimpleConfirmDialog";
import {
  DAY_MS,
  timelineFocusScrollLeft as focusScrollLeft,
  timelineGetRange as getRange,
  timelineStartOfDay as startOfDay,
} from "../../../lib/database/timelineGeometry";
import {
  toDateIso,
  startOfMonth,
  monthInputToStart,
} from "../../../lib/database/timelineDateUtils";
import { isInteractiveTarget } from "./timelineSelectionGeometry";
import { useTimelineColumns } from "./useTimelineColumns";
import { useTimelineAxis } from "./useTimelineAxis";
import { TimelineControlBar } from "./TimelineControlBar";
import { TimelineDateCardSettings } from "./TimelineDateCardSettings";
import { useTimelineCardLayouts } from "./useTimelineCardLayouts";
import {
  ROW_HEIGHT,
  ROW_GAP,
  HEADER_HEIGHT,
  SIDE_LABEL_W,
  SIDE_LABEL_W_MIN,
  SIDE_LABEL_W_MAX,
  UNSCHEDULED_CARD_LEFT,
} from "./timelineLayoutConstants";
import { CELL_WIDTH_MIN, CELL_WIDTH_MAX, CELL_WIDTH_DEFAULT } from "./timelineZoom";
import type {
  Granularity,
  ContextPointerEvent,
  TimelineBoxRect,
  TimelineCardLayout,
} from "./timelineTypes";
import { makeTimelineCardId } from "./timelineCardUtils";
import { useWindowedRows } from "./useWindowedRows";
import { TimelineCardPropertyLabels } from "../TimelineCardPropertyLabels";
import { ScheduleCardDetailRows } from "../ScheduleCardDetailRows";
import { getScheduleCardContentOffset } from "../../scheduler/scheduleCardDisplay";
import { animateScrollLeft } from "../../../lib/animateScroll";
import { TimelineCardText } from "../TimelineCardText";
import {
  applyTimelineCardStickyOffset,
  applyUnscheduledCardPin,
} from "../timelineCardStickyOffset";
import { buildTimelineCardConfigPatch } from "./timelineCardConfig";
import { ContextMenu, announceSchedulerContextMenuOpen } from "../../scheduler/ContextMenu";
import {
  makeTimelineCardColorOverrides,
  TIMELINE_CARD_COLOR_OVERRIDES_CELL_ID,
} from "../../../lib/database/timelineCardColor";
import { useAddDatabaseRowAndOpen, useOpenDatabaseRow } from "../useOpenDatabaseRow";

type Props = {
  databaseId: string;
  panelState: DatabasePanelState;
  setPanelState: (p: Partial<DatabasePanelState>) => void;
  /** 표시할 최대 행 수. 미지정 시 전체 표시. */
  visibleRowLimit?: number;
};

const LS_ZOOM_KEY = "quicknote.timeline.zoom";
const LS_GRANULARITY_KEY = "quicknote.timeline.granularity";
const LS_MONTH_KEY = "quicknote.timeline.month";
const DRAG_ACTIVATE_PX = 3;

let lastTimelineScrollerClientWidth = 0;

function estimateTimelineScrollerClientWidth(): number {
  if (lastTimelineScrollerClientWidth > 0) return lastTimelineScrollerClientWidth;
  if (typeof window === "undefined") return 900;
  return Math.max(360, Math.min(1400, window.innerWidth - 280));
}

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
      // 단일 클릭 = 일정 카드로 스크롤 포커싱, 더블 클릭 = 사이드바(피커뷰) 열기.
      onClick={() => onFocus(row.pageId)}
      onDoubleClick={() => openPeek(row.pageId)}
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
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-700 dark:text-zinc-200">
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

// 항목 선택 시 가로 포커싱 스크롤 지속 시간(ms). 0.3초 동안 부드럽게 이동.
const FOCUS_SCROLL_DURATION_MS = 300;

export function DatabaseTimelineView({
  databaseId,
  panelState,
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
  const renderedRows = useMemo(
    () =>
      virtualRows.enabled
        ? rows.slice(virtualRows.start, virtualRows.end)
        : rows,
    [rows, virtualRows.enabled, virtualRows.end, virtualRows.start],
  );
  const totalRowsHeight = rows.length * (ROW_HEIGHT + ROW_GAP);
  const deleteRow = useDatabaseStore((s) => s.deleteRow);
  const updateColumn = useDatabaseStore((s) => s.updateColumn);
  const updateCell = useDatabaseStore((s) => s.updateCell);
  const openRow = useOpenDatabaseRow(databaseId);
  const addRowAndOpen = useAddDatabaseRowAndOpen(databaseId);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  // 진행 중인 포커싱 스크롤 애니메이션 핸들 — 새 포커싱/언마운트 시 중단한다.
  const focusScrollRef = useRef<{ cancel: () => void } | null>(null);
  // 포커싱 애니메이션 진행 중 여부 — true 인 동안에는 onScroll 의 sticky 재렌더를 건너뛴다.
  const focusAnimatingRef = useRef(false);
  useEffect(() => () => focusScrollRef.current?.cancel(), []);
  // 긴 카드 텍스트 sticky 처리를 위한 가로 스크롤 위치. focusTimelineCard 보다 먼저 선언해
  // setter 가 안정적(stable)으로 인식되도록 한다(React Compiler 메모이제이션 보존).
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0);
  const [granularity, setGranularity] = useState<Granularity>(() => {
    const saved = localStorage.getItem(LS_GRANULARITY_KEY);
    return saved === "month" || saved === "week" || saved === "year" ? saved : "year";
  });
  const [visibleMonthStart, setVisibleMonthStart] = useState(() => {
    const saved = localStorage.getItem(LS_MONTH_KEY);
    return monthInputToStart(saved ?? "") ?? startOfMonth(Date.now());
  });
  // 연간 축에서 보고 있는 연도 (LC 스케줄러와 동일하게 연도 단위 이동).
  const [visibleYear, setVisibleYear] = useState(() => new Date().getFullYear());

  useEffect(() => {
    localStorage.setItem(LS_GRANULARITY_KEY, granularity);
  }, [granularity]);
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
  const headerYearTrackRef = useRef<HTMLDivElement | null>(null);
  // 실측 너비는 0 으로 덮어쓰지 않는다. 0 으로 두면 fit 축에서 pxPerDay=0 → cardLayouts 가
  // 빈 배열이 되어 카드가 사라지는 빈 프레임(깜빡임)이 생긴다.
  const measureTrack = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const w = el.clientWidth;
    if (w > 0) setTrackPxWidth((prev) => (prev === w ? prev : w));
  }, []);
  // 트랙 DOM 이 붙는 즉시(커밋 단계, 페인트 전) 동기 측정한다. 날짜 라인이 CSS % 라 안 깜빡이듯,
  // 카드도 첫 페인트부터 올바른 픽셀 너비를 갖게 해 측정 공백으로 인한 깜빡임을 없앤다.
  const setTrackNode = useCallback(
    (node: HTMLDivElement | null) => {
      trackRef.current = node;
      if (!node) return;
      const w = node.clientWidth;
      if (w > 0) setTrackPxWidth((prev) => (prev === w ? prev : w));
    },
    [],
  );
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measureTrack());
    ro.observe(el);
    measureTrack();
    return () => ro.disconnect();
  }, [granularity, measureTrack]);

  // 깜빡임 대신 "빈 상태 → 한 번에 완성된 모습". 너비가 잡힌 뒤에도 react-rnd 가 페인트 직후
  // 부모 offset 을 재측정해 카드를 한 번 더 옮기므로, 측정 후 2프레임(rAF) 기다려 카드 위치·
  // 스크롤이 모두 정착한 다음 본문을 드러낸다. 그 전에는 visibility 로 숨긴다(공간은 예약).
  const [contentReady, setContentReady] = useState(false);
  useEffect(() => {
    if (trackPxWidth <= 0 || contentReady) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setContentReady(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [trackPxWidth, contentReady]);
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
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const selectedCardIdsRef = useRef(selectedCardIds);
  const commitSelectedCardIds = useCallback((next: Set<string>) => {
    const prev = selectedCardIdsRef.current;
    if (
      prev.size === next.size &&
      Array.from(prev).every((id) => next.has(id))
    ) {
      return;
    }
    selectedCardIdsRef.current = next;
    setSelectedCardIds(next);
  }, []);
  const [selectionRect, setSelectionRect] = useState<TimelineBoxRect | null>(null);
  const selectionRectRef = useRef<TimelineBoxRect | null>(null);
  const boxSelectingRef = useRef(false);
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const [isMultiDragging, setIsMultiDragging] = useState(false);
  const [multiDragDeltaX, setMultiDragDeltaX] = useState(0);
  const scrollLockLeftRef = useRef<number | null>(null);

  const [timelineSettingsOpen, setTimelineSettingsOpen] = useState(false);

  // 날짜 컬럼을 표시설정(viewConfigs.timeline) 순서대로 정렬한다.
  // → 표시설정에서 날짜 속성을 앞으로 옮기면 그 컬럼이 primary/첫 포커싱 대상이 되도록.
  // 날짜 컬럼/타임라인 카드 엔트리 파생(순수 useMemo 묶음)은 useTimelineColumns 로 추출.
  const {
    dateCols,
    primaryDateCol,
    dateColId,
    hasExplicitTimelineCards,
    timelineDateEntries,
    timelineExcludeColumnIds,
    visibleTimelineColumnIdSet,
  } = useTimelineColumns(columns, panelState);

  const updateTimelineCardConfig = useCallback(
    (column: ColumnDef, patch: TimelineDateCardConfig) => {
      updateColumn(databaseId, column.id, {
        config: buildTimelineCardConfigPatch(databaseId, column, patch),
      });
    },
    [databaseId, updateColumn],
  );

  const updateTimelineCardColor = useCallback(
    (card: TimelineCardLayout, color: string) => {
      updateCell(
        databaseId,
        card.pageId,
        TIMELINE_CARD_COLOR_OVERRIDES_CELL_ID,
        makeTimelineCardColorOverrides(card.row.cells, card.columnId, color),
      );
    },
    [databaseId, updateCell],
  );

  useEffect(() => {
    const handleNativeContextMenu = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest("[data-db-timeline-card='true']")) {
        event.preventDefault();
      }
    };

    document.addEventListener("contextmenu", handleNativeContextMenu, true);
    return () => document.removeEventListener("contextmenu", handleNativeContextMenu, true);
  }, []);

  const setTimelineColumnEnabled = useCallback(
    (column: ColumnDef, enabled: boolean) => {
      if (enabled && !hasExplicitTimelineCards && primaryDateCol && primaryDateCol.id !== column.id) {
        updateTimelineCardConfig(primaryDateCol, { enabled: true });
      }
      updateTimelineCardConfig(column, { enabled });
    },
    [hasExplicitTimelineCards, primaryDateCol, updateTimelineCardConfig],
  );

  // 순수 축 스케일/틱 계산은 useTimelineAxis 로 추출(DOM·스크롤·ref 무관).
  const {
    isYearAxis,
    isWeekAxis,
    isMonthAxis,
    usesScrollableAxis,
    usesFitAxis,
    axis,
    pxPerDay,
    dayToX,
    dayWidth,
    headerTicks,
    weekendStrips,
    todayX,
  } = useTimelineAxis({ granularity, visibleMonthStart, visibleYear, cellWidthOverride, trackPxWidth });

  const getTodayScrollLeft = useCallback((el: HTMLElement): number => {
    if (!isYearAxis) return 0;
    const now = startOfDay(Date.now());
    if (now < axis.minT || now > axis.maxT) return 0;
    const clientWidth = el.clientWidth;
    const maxScrollLeft = Math.max(0, el.scrollWidth - clientWidth);
    const centered = Math.max(0, todayX - clientWidth / 2);
    return maxScrollLeft > 0 ? Math.min(centered, maxScrollLeft) : centered;
  }, [axis.maxT, axis.minT, isYearAxis, todayX]);

  const initialYearScrollKey = isYearAxis
    ? `${visibleYear}:${axis.totalW}:${todayX}`
    : null;
  const scrollableContentWidth = sideLabelWidth + axis.totalW;
  const [initialYearClientWidth] = useState(() => estimateTimelineScrollerClientWidth());
  const [yearScrollSyncedKey, setYearScrollSyncedKey] = useState<string | null>(null);
  const initialVisualScrollLeft = useMemo(() => {
    if (!isYearAxis || !initialYearScrollKey) return 0;
    const now = startOfDay(Date.now());
    if (now < axis.minT || now > axis.maxT) return 0;
    const maxScrollLeft = Math.max(0, scrollableContentWidth - initialYearClientWidth);
    const centered = Math.max(0, todayX - initialYearClientWidth / 2);
    return maxScrollLeft > 0 ? Math.min(centered, maxScrollLeft) : centered;
  }, [
    axis.maxT,
    axis.minT,
    initialYearClientWidth,
    initialYearScrollKey,
    isYearAxis,
    scrollableContentWidth,
    todayX,
  ]);
  const visualScrollCompensation =
    isYearAxis && yearScrollSyncedKey !== initialYearScrollKey
      ? initialVisualScrollLeft
      : 0;
  const yearTrackVisualStyle = visualScrollCompensation > 0
    ? { transform: `translateX(${-visualScrollCompensation}px)` }
    : undefined;
  const displayTimelineScrollLeft = visualScrollCompensation > 0
    ? visualScrollCompensation
    : timelineScrollLeft;
  const timelineCardLayoutSyncKey = isYearAxis
    ? `${initialYearScrollKey ?? "year"}:${yearScrollSyncedKey === initialYearScrollKey ? "synced" : "visual"}:${trackPxWidth > 0 ? "ready" : "pending"}`
    : `${granularity}:${trackPxWidth > 0 ? "ready" : "pending"}`;

  const { cardLayouts, getCardsInRect } = useTimelineCardLayouts({
    timelineDateEntries,
    renderedRows,
    virtualRowsStart: virtualRows.start,
    axis,
    pxPerDay,
    dayToX,
    dayWidth,
    isWeekAxis,
    usesFitAxis,
    usesScrollableAxis,
    trackPxWidth,
    visibleTimelineColumnIdSet,
  });

  useEffect(() => {
    const pageIds = new Set(rows.map((row) => row.pageId));
    if (selectedPageId && !pageIds.has(selectedPageId)) {
      setSelectedPageId(null);
    }
    const validCardIds = new Set<string>();
    for (const row of rows) {
      for (const entry of timelineDateEntries) {
        validCardIds.add(makeTimelineCardId(row.pageId, entry.columnId));
      }
    }
    if (selectedCardId && !validCardIds.has(selectedCardId)) {
      setSelectedCardId(null);
    }
    commitSelectedCardIds(
      new Set(Array.from(selectedCardIdsRef.current).filter((id) => validCardIds.has(id))),
    );
  }, [commitSelectedCardIds, rows, selectedCardId, selectedPageId, timelineDateEntries]);

  const scrollToToday = useCallback(() => {
    if (isMonthAxis) {
      setVisibleMonthStart(startOfMonth(Date.now()));
      return;
    }
    if (isYearAxis) {
      // 다른 연도를 보고 있으면 올해로 전환 (다음 렌더에서 오늘 위치로 스크롤됨).
      const thisYear = new Date().getFullYear();
      if (visibleYear !== thisYear) {
        setVisibleYear(thisYear);
        return;
      }
    }
    const el = scrollContainerRef.current;
    if (!el) return;
    const nextScrollLeft = getTodayScrollLeft(el);
    el.scrollLeft = nextScrollLeft;
    setTimelineScrollLeft(nextScrollLeft);
    applyTimelineCardStickyOffset(el, nextScrollLeft);
    applyUnscheduledCardPin(el, nextScrollLeft);
  }, [getTodayScrollLeft, isMonthAxis, isYearAxis, visibleYear]);

  const focusTimelineCard = useCallback((pageId: string) => {
    const row = rows.find((item) => item.pageId === pageId) ?? null;
    const targetEntry =
      row
        ? timelineDateEntries.find((entry) => getRange(row.cells[entry.columnId])) ??
          timelineDateEntries.find((entry) => entry.isPrimary) ??
          timelineDateEntries[0] ??
          null
        : null;
    const targetRange = row && targetEntry ? getRange(row.cells[targetEntry.columnId]) : null;
    // 포커싱 대상 = 값이 등록된 첫 번째 날짜 컬럼의 카드. (없으면 primary→첫 항목)
    const targetCardId = targetEntry ? makeTimelineCardId(pageId, targetEntry.columnId) : null;
    setSelectedPageId(pageId);
    setSelectedCardId(targetCardId);
    commitSelectedCardIds(new Set());
    // 월 축은 visibleMonthStart 가 속한 달의 항목만 렌더한다.
    // 다른 달 항목을 클릭하면 해당 항목 시작일의 달로 먼저 전환해야 카드가 보인다.
    if (isMonthAxis && targetRange) {
      const targetMonth = startOfMonth(targetRange.start);
      setVisibleMonthStart((prev) => (prev === targetMonth ? prev : targetMonth));
    }
    // 대상 카드를 화면 가로 중앙으로 0.3초 동안 부드럽게 이동.
    // 라벨 행은 좌측 sticky 컬럼이라 클릭 시점에 이미 세로로 보이므로 세로 스크롤은 불필요하다.
    // 가로 스크롤이 있는 연간 축에서만 의미가 있다(월/주 축은 화면 폭에 맞춰져 스크롤이 없다).
    // 카드 위치는 DOM 조회(react-rnd 가 data-* 속성을 DOM 에 전달하는지에 의존, 실패 시 무동작)
    // 대신 카드 렌더와 동일한 레이아웃 계산(dayToX/dayWidth)으로 직접 구해 항상 동작하게 한다.
    if (usesScrollableAxis && targetRange) {
      const visStart = Math.max(targetRange.start, axis.minT);
      const visEnd = Math.min(targetRange.end, axis.maxT);
      // 대상 날짜가 현재 연도 범위를 벗어나면 표시할 카드가 없어 스크롤하지 않는다.
      if (visEnd >= axis.minT && visStart <= axis.maxT) {
        // 선택 상태 반영(re-render) 후의 레이아웃 기준으로 측정하도록 다음 프레임에서 실행.
        window.requestAnimationFrame(() => {
          const root = scrollContainerRef.current;
          if (!root) return;
          const cardLeft = dayToX(visStart);
          const maxLeft = Math.max(0, root.scrollWidth - root.clientWidth);
          const target = focusScrollLeft({
            cardLeft,
            pxPerDay,
            maxLeft,
          });
          focusScrollRef.current?.cancel();
          // 애니메이션 중에는 onScroll 의 sticky 재렌더(전체 카드 리렌더)를 멈춰 프레임을 매끄럽게 한다.
          // 대신 카드 내부 텍스트의 sticky 오프셋은 매 프레임 DOM transform 으로 직접 갱신해
          // (React 리렌더 없이) 스크롤에 맞춰 부드럽게 따라오게 한다.
          focusAnimatingRef.current = true;
          focusScrollRef.current = animateScrollLeft(
            root,
            target,
            FOCUS_SCROLL_DURATION_MS,
            () => {
              focusAnimatingRef.current = false;
              // 종료 후 React 가 인라인 style 로 최종 오프셋을 다시 설정하도록 한 번만 동기화.
              setTimelineScrollLeft(root.scrollLeft);
            },
            (scrollLeft) => {
              applyTimelineCardStickyOffset(root, scrollLeft);
              // 미등록 카드는 매 프레임 화면 고정해 애니메이션 중 밀림/깜빡임을 방지.
              applyUnscheduledCardPin(root, scrollLeft);
            },
          );
        });
      }
    }
  }, [
    axis.minT,
    axis.maxT,
    commitSelectedCardIds,
    dayToX,
    isMonthAxis,
    pxPerDay,
    rows,
    timelineDateEntries,
    usesScrollableAxis,
  ]);

  const commitRange = useCallback(
    (card: TimelineCardLayout, start: number, end: number) => {
      updateCell(databaseId, card.pageId, card.columnId, {
        start: toDateIso(start),
        end: toDateIso(end),
      });
    },
    [databaseId, updateCell],
  );

  const moveCardsByDays = useCallback(
    (cardIds: Iterable<string>, deltaDays: number) => {
      if (deltaDays === 0) return;
      const deltaMs = deltaDays * DAY_MS;
      for (const cardId of cardIds) {
        const card = cardLayouts.find((item) => item.id === cardId);
        if (!card || card.isUnscheduled) continue;
        const range = getRange(card.row.cells[card.columnId]);
        if (!range) continue;
        commitRange(card, range.start + deltaMs, range.end + deltaMs);
      }
    },
    [cardLayouts, commitRange],
  );

  const selectCard = useCallback((card: TimelineCardLayout) => {
    setSelectedPageId(card.pageId);
    setSelectedCardId(card.id);
    if (selectedCardIdsRef.current.has(card.id)) return;
    commitSelectedCardIds(new Set());
  }, [commitSelectedCardIds]);

  const openPageFromKeyboard = useCallback(() => {
    if (!selectedPageId) return;
    void openRow(selectedPageId, { source: "database-timeline-keyboard-open" });
  }, [openRow, selectedPageId]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isInteractiveTarget(event.target)) return;
      if (event.key === "Escape" && selectedCardIds.size > 0) {
        commitSelectedCardIds(new Set());
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
  }, [commitSelectedCardIds, openPageFromKeyboard, selectedCardIds.size, selectedPageId]);

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
      commitSelectedCardIds(new Set());
      setSelectedPageId(null);
      setSelectedCardId(null);
      setIsBoxSelecting(true);
    },
    [commitSelectedCardIds, pointFromEvent],
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
      commitSelectedCardIds(getCardsInRect(next));
    };
    const onUp = () => {
      if (!boxSelectingRef.current) return;
      const finalRect = selectionRectRef.current;
      commitSelectedCardIds(finalRect ? getCardsInRect(finalRect) : new Set());
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
  }, [commitSelectedCardIds, getCardsInRect, pointFromEvent]);

  const lockTimelineScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    scrollLockLeftRef.current = el?.scrollLeft ?? null;
  }, []);

  const unlockTimelineScroll = useCallback(() => {
    scrollLockLeftRef.current = null;
  }, []);

  const scrollSyncRafRef = useRef<number | null>(null);

  const handleTimelineScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    // 리사이즈 중 가로 스크롤 위치 고정
    const locked = scrollLockLeftRef.current;
    if (locked != null && el && el.scrollLeft !== locked) {
      el.scrollLeft = locked;
    }
    // 포커싱 애니메이션이 도는 동안에는 sticky 동기화를 건너뛴다.
    // (프레임마다 timelineScrollLeft state 를 갱신하면 전체 카드가 리렌더되어 프레임이 끊긴다.
    //  애니메이션 종료 시 onComplete 에서 한 번만 동기화한다.)
    if (focusAnimatingRef.current) return;
    // 긴 카드 텍스트 sticky 처리를 위한 scrollLeft 추적 (rAF 스로틀)
    if (!el || scrollSyncRafRef.current != null) return;
    scrollSyncRafRef.current = window.requestAnimationFrame(() => {
      scrollSyncRafRef.current = null;
      const node = scrollContainerRef.current;
      if (node) {
        setTimelineScrollLeft(node.scrollLeft);
      }
    });
  }, []);

  const applyInitialTimelineScroll = useCallback((el: HTMLDivElement) => {
    if (!isYearAxis) {
      if (el && el.scrollLeft !== 0) el.scrollLeft = 0;
      setTimelineScrollLeft(0);
      setYearScrollSyncedKey(null);
      return;
    }
    if (!el || axis.totalW <= 0 || el.clientWidth === 0 || !initialYearScrollKey) return;
    if (yearScrollSyncedKey === initialYearScrollKey) return;
    if (el.scrollWidth <= el.clientWidth && scrollableContentWidth > el.clientWidth) return;
    lastTimelineScrollerClientWidth = el.clientWidth;
    const nextScrollLeft = getTodayScrollLeft(el);
    headerYearTrackRef.current?.style.removeProperty("transform");
    trackRef.current?.style.removeProperty("transform");
    el.scrollLeft = nextScrollLeft;
    setTimelineScrollLeft(nextScrollLeft);
    applyTimelineCardStickyOffset(el, nextScrollLeft);
    applyUnscheduledCardPin(el, nextScrollLeft);
    setYearScrollSyncedKey(initialYearScrollKey);
  }, [
    axis.totalW,
    getTodayScrollLeft,
    initialYearScrollKey,
    isYearAxis,
    scrollableContentWidth,
    yearScrollSyncedKey,
  ]);

  const setScrollContainerNode = useCallback((node: HTMLDivElement | null) => {
    scrollContainerRef.current = node;
    if (node) applyInitialTimelineScroll(node);
  }, [applyInitialTimelineScroll]);

  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    applyInitialTimelineScroll(el);
  }, [
    applyInitialTimelineScroll,
    trackPxWidth,
  ]);

  const selectedMultiPageIds = useMemo(() => {
    const pageIds = new Set<string>();
    if (selectedCardIds.size === 0) return pageIds;
    for (const card of cardLayouts) {
      if (selectedCardIds.has(card.id)) pageIds.add(card.pageId);
    }
    return pageIds;
  }, [cardLayouts, selectedCardIds]);

  if (!bundle) return null;

  return (
    <div className="select-none pt-3">
      {/* 컨트롤 바 */}
      <TimelineControlBar
        granularity={granularity}
        setGranularity={setGranularity}
        dateColsCount={dateCols.length}
        timelineSettingsOpen={timelineSettingsOpen}
        setTimelineSettingsOpen={setTimelineSettingsOpen}
        isMonthAxis={isMonthAxis}
        isYearAxis={isYearAxis}
        isWeekAxis={isWeekAxis}
        visibleMonthStart={visibleMonthStart}
        setVisibleMonthStart={setVisibleMonthStart}
        visibleYear={visibleYear}
        setVisibleYear={setVisibleYear}
        cellWidthOverride={cellWidthOverride}
        setCellWidthOverride={setCellWidthOverride}
        scrollToToday={scrollToToday}
      />

      {timelineSettingsOpen && dateCols.length > 0 && (
        <TimelineDateCardSettings
          dateCols={dateCols}
          hasExplicitTimelineCards={hasExplicitTimelineCards}
          dateColId={dateColId}
          setTimelineColumnEnabled={setTimelineColumnEnabled}
          updateTimelineCardConfig={updateTimelineCardConfig}
        />
      )}

      {!dateColId ? (
        <p className="py-6 text-center text-xs text-zinc-500">
          날짜 타입 속성을 추가한 뒤 타임라인 축으로 지정하세요.
        </p>
      ) : (
        <div
          ref={setScrollContainerNode}
          onMouseDown={beginBoxSelection}
          onScroll={handleTimelineScroll}
          className={[
            "qn-database-subtle-scrollbar",
            usesScrollableAxis ? "overflow-x-auto" : "overflow-hidden",
          ].join(" ")}
          // 카드 위치가 완전히 정착하기 전에는 숨긴다 (깜빡임 대신 빈 상태 → 한 번에 노출).
          style={{ visibility: contentReady ? undefined : "hidden" }}
        >
          <div
            className="relative"
            style={{
              width:
                usesScrollableAxis
                  ? scrollableContentWidth
                  : "100%",
              minWidth: usesScrollableAxis ? scrollableContentWidth : undefined,
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
              ) : isMonthAxis ? (
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
                <div
                  ref={headerYearTrackRef}
                  className="relative shrink-0"
                  style={{ width: axis.totalW, minWidth: axis.totalW, ...yearTrackVisualStyle }}
                >
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
            <div
              ref={virtualRows.containerRef}
              className="flex"
              style={
                usesScrollableAxis
                  ? { width: scrollableContentWidth, minWidth: scrollableContentWidth }
                  : undefined
              }
            >
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
                    isSelected={selectedPageId === row.pageId || selectedMultiPageIds.has(row.pageId)}
                    onFocus={focusTimelineCard}
                    openPeek={(pageId) => void openRow(pageId, { source: "database-timeline-label-open" })}
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
                ref={setTrackNode}
                className={usesScrollableAxis ? "relative shrink-0" : "relative flex-1"}
                style={
                  usesScrollableAxis
                    ? {
                        width: axis.totalW,
                        minWidth: axis.totalW,
                        height: totalRowsHeight,
                        ...yearTrackVisualStyle,
                      }
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
                    key={card.id}
                    card={card}
                    databaseId={databaseId}
                    excludeColumnIds={timelineExcludeColumnIds}
                    viewConfigs={panelState.viewConfigs}
                    axisMinT={axis.minT}
                    pxPerDay={pxPerDay}
                    scrollLeft={displayTimelineScrollLeft}
                    layoutSyncKey={timelineCardLayoutSyncKey}
                    selected={selectedCardId === card.id}
                    multiSelected={selectedCardIds.has(card.id)}
                    multiDragDeltaX={
                      isMultiDragging && selectedCardIds.has(card.id)
                        ? multiDragDeltaX
                        : null
                    }
                    onSelect={selectCard}
                    onOpenPeek={(pageId) => void openRow(pageId, { source: "database-timeline-card-open" })}
                    onMove={(targetCard, deltaDays) => moveCardsByDays([targetCard.id], deltaDays)}
                    onResize={(targetCard, start, end) => commitRange(targetCard, start, end)}
                    onColorChange={updateTimelineCardColor}
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
        onClick={() =>
          void addRowAndOpen(resolveActiveFilterRules(panelState), {
            source: "database-timeline-add-row-open",
          })
        }
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
              setSelectedCardId(null);
              const next = new Set(selectedCardIdsRef.current);
              for (const entry of timelineDateEntries) {
                next.delete(makeTimelineCardId(rowDeletePageId, entry.columnId));
              }
              commitSelectedCardIds(next);
            }
            setRowDeletePageId(null);
          }}
      />
    </div>
  );
}

function DatabaseTimelineCard({
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
