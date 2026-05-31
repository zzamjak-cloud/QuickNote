// LC 마일스톤/피처 DB 행을 스케줄러 타임라인으로 투영하는 읽기 전용 뷰.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Database, Layers, PanelRight } from "lucide-react";
import { useDatabaseStore } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";
import { useSchedulerViewStore, type SchedulerEntityMode } from "../../store/schedulerViewStore";
import { useUiStore } from "../../store/uiStore";
import type { CellValue, ColumnDef } from "../../types/database";
import type { Page } from "../../types/page";
import { pickTextColor } from "../../lib/scheduler/colors";
import {
  addDays,
  daysInYear,
  isSameDay,
  startOfDay,
  startOfWeek,
  todayIndex as calcTodayIndex,
} from "../../lib/scheduler/dateUtils";
import { clampVisibleRange } from "../../lib/scheduler/gridUtils";
import { CARD_MARGIN, ROW_PADDING_TOP, getCellWidth, getRowHeight } from "../../lib/scheduler/grid";
import { getHolidaysForYear } from "../../lib/scheduler/koreanHolidays";
import { LC_FEATURE_COLUMN_IDS, makeLCFeatureDatabaseId } from "../../lib/scheduler/featureDatabase";
import { LC_MILESTONE_COLUMN_IDS, makeLCMilestoneDatabaseId } from "../../lib/scheduler/milestoneDatabase";
import {
  getScopedMilestoneIds,
  matchesSchedulerScope,
  schedulerPageLinkIncludes,
} from "../../lib/scheduler/databaseScope";
import { useSchedulerHolidaysStore } from "../../store/schedulerHolidaysStore";
import { DateAxis } from "./DateAxis";
import { GridRow } from "./GridRow";
import { PageIconDisplay } from "../common/PageIconDisplay";
import {
  addWeeks,
  buildMonthDaySlots,
  buildWeekDaySlots,
  differenceInCalendarDays,
  fmtDow,
  fmtMD,
  relativeWeekTitle,
  subDays,
  type WeekDaySlot,
} from "./schedule/weekScheduleUtils";

const DATE_AXIS_HEIGHT = 76;
const ITEM_COLUMN_WIDTH = 220;
const BOTTOM_SPACER_HEIGHT = 220;

type TimelineMode = Exclude<SchedulerEntityMode, "task">;

type Props = {
  mode: TimelineMode;
  workspaceId: string;
};

type DateRange = {
  start: Date;
  end: Date;
};

type TimelineCard = {
  id: string;
  pageId: string;
  title: string;
  start: Date;
  end: Date;
  color: string;
};

type TimelineRow = {
  page: Page;
  cards: TimelineCard[];
};

function parseCellDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeRange(start: Date, end: Date): DateRange {
  return start.getTime() <= end.getTime() ? { start, end } : { start: end, end: start };
}

function readDateRange(value: CellValue): DateRange | null {
  if (typeof value === "string") {
    const date = parseCellDate(value);
    return date ? { start: date, end: date } : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const start = parseCellDate(record.start);
  const end = parseCellDate(record.end);
  const resolvedStart = start ?? end;
  const resolvedEnd = end ?? start;
  return resolvedStart && resolvedEnd ? normalizeRange(resolvedStart, resolvedEnd) : null;
}

function resolveCardTitle(
  page: Page,
  column: ColumnDef | undefined,
  fallback: string,
  usePageTitle: boolean,
): string {
  const config = column?.config?.timelineCard;
  if (config?.titleMode === "pageTitle") return page.title.trim() || "제목 없음";
  if (config?.titleMode === "custom") return config.title?.trim() || fallback;
  return usePageTitle ? page.title.trim() || "제목 없음" : fallback;
}

function resolveCardColor(column: ColumnDef | undefined, fallback: string): string {
  return column?.config?.timelineCard?.color ?? fallback;
}

function milestoneCards(page: Page, columnsById: Map<string, ColumnDef>): TimelineCard[] {
  const cells = page.dbCells ?? {};
  const specs = [
    {
      columnId: LC_MILESTONE_COLUMN_IDS.devPeriod,
      fallbackTitle: page.title.trim() || "제목 없음",
      usePageTitle: true,
      color: "#2563eb",
    },
    {
      columnId: LC_MILESTONE_COLUMN_IDS.qaStart,
      fallbackTitle: "QA",
      usePageTitle: false,
      color: "#9333ea",
    },
    {
      columnId: LC_MILESTONE_COLUMN_IDS.submit,
      fallbackTitle: "서밋",
      usePageTitle: false,
      color: "#f59e0b",
    },
    {
      columnId: LC_MILESTONE_COLUMN_IDS.release,
      fallbackTitle: "출시",
      usePageTitle: false,
      color: "#dc2626",
    },
  ];

  return specs.flatMap((spec) => {
    const column = columnsById.get(spec.columnId);
    if (column?.config?.timelineCard?.enabled === false) return [];
    const range = readDateRange(cells[spec.columnId]);
    if (!range) return [];
    return [
      {
        id: `${page.id}:${spec.columnId}`,
        pageId: page.id,
        title: resolveCardTitle(page, column, spec.fallbackTitle, spec.usePageTitle),
        start: range.start,
        end: range.end,
        color: resolveCardColor(column, spec.color),
      },
    ];
  });
}

function featureCards(page: Page, columnsById: Map<string, ColumnDef>): TimelineCard[] {
  const cells = page.dbCells ?? {};
  const startRange = readDateRange(cells[LC_FEATURE_COLUMN_IDS.workStart]);
  const endRange = readDateRange(cells[LC_FEATURE_COLUMN_IDS.workEnd]);
  const start = startRange?.start ?? endRange?.start ?? null;
  const end = endRange?.end ?? endRange?.start ?? startRange?.end ?? start;
  const column = columnsById.get(LC_FEATURE_COLUMN_IDS.workStart);
  if (!start || !end || column?.config?.timelineCard?.enabled === false) return [];
  const range = normalizeRange(start, end);
  return [
    {
      id: `${page.id}:${LC_FEATURE_COLUMN_IDS.workStart}:${LC_FEATURE_COLUMN_IDS.workEnd}`,
      pageId: page.id,
      title: resolveCardTitle(page, column, page.title.trim() || "제목 없음", true),
      start: range.start,
      end: range.end,
      color: resolveCardColor(column, "#16a34a"),
    },
  ];
}

function cardOverlapsSlot(card: TimelineCard, slot: WeekDaySlot): boolean {
  const dayStart = startOfDay(slot.date).getTime();
  const dayEnd = addDays(startOfDay(slot.date), 1).getTime();
  return startOfDay(card.start).getTime() < dayEnd && startOfDay(card.end).getTime() + 86400000 > dayStart;
}

function getCardSlotRange(card: TimelineCard, slots: WeekDaySlot[]): { startSlot: number; endSlot: number } | null {
  let startSlot = -1;
  let endSlot = -1;
  slots.forEach((slot, index) => {
    if (!cardOverlapsSlot(card, slot)) return;
    if (startSlot < 0) startSlot = index;
    endSlot = index;
  });
  if (startSlot < 0 || endSlot < 0) return null;
  return { startSlot, endSlot };
}

export function SchedulerDatabaseTimeline({ mode, workspaceId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const milestoneDatabaseId = makeLCMilestoneDatabaseId(workspaceId);
  const featureDatabaseId = makeLCFeatureDatabaseId(workspaceId);
  const databaseId =
    mode === "milestone"
      ? milestoneDatabaseId
      : featureDatabaseId;
  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const milestoneDb = useDatabaseStore((s) => s.databases[milestoneDatabaseId]);
  const selectedFeatureMilestoneIds =
    useDatabaseStore((s) => s.databases[featureDatabaseId]?.panelState?.schedulerFeatureMilestoneIds) ??
    null;
  const pages = usePageStore((s) => s.pages);
  const openPeek = useUiStore((s) => s.openPeek);
  const viewMode = useSchedulerViewStore((s) => s.viewMode);
  const zoomLevel = useSchedulerViewStore((s) => s.zoomLevel);
  const columnWidthScale = useSchedulerViewStore((s) => s.columnWidthScale);
  const currentYear = useSchedulerViewStore((s) => s.currentYear);
  const setCurrentYear = useSchedulerViewStore((s) => s.setCurrentYear);
  const selectedProjectId = useSchedulerViewStore((s) => s.selectedProjectId);
  const weekendColor = useSchedulerViewStore((s) => s.weekendColor);
  const storeHolidays = useSchedulerHolidaysStore((s) => s.holidays);
  const [rangeTimelineWidth, setRangeTimelineWidth] = useState(900);
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthIndex, setMonthIndex] = useState(() => new Date().getMonth());
  // 리스트 클릭 시 해당 행/카드로 스크롤하기 위한 대기 상태 (뷰 범위 변경 후 다음 렌더에서 처리)
  const [pendingFocusPageId, setPendingFocusPageId] = useState<string | null>(null);

  const isAnnualView = viewMode === "year";
  const annualCellWidth = getCellWidth(zoomLevel, columnWidthScale);
  const total = daysInYear(currentYear);
  const annualTotalWidth = total * annualCellWidth;
  const rowHeight = getRowHeight(1, zoomLevel);
  const cardHeight = Math.max(22, Math.min(30, rowHeight - ROW_PADDING_TOP * 2));
  const todayIdx = calcTodayIndex(currentYear);

  const rows = useMemo<TimelineRow[]>(() => {
    if (!bundle) return [];
    const columnsById = new Map(bundle.columns.map((column) => [column.id, column]));
    const scopedMilestoneIds =
      mode === "feature" && selectedProjectId && milestoneDb
        ? getScopedMilestoneIds(milestoneDb.rowPageOrder, pages, selectedProjectId)
        : null;
    const visibleMilestoneFilterIds =
      selectedFeatureMilestoneIds === null
        ? null
        : selectedFeatureMilestoneIds.filter((id) => !scopedMilestoneIds || scopedMilestoneIds.has(id));
    const milestoneFilterSet =
      mode === "feature" && selectedFeatureMilestoneIds !== null
        ? selectedFeatureMilestoneIds.length === 0
          ? new Set<string>()
          : visibleMilestoneFilterIds && visibleMilestoneFilterIds.length > 0
            ? new Set(visibleMilestoneFilterIds)
            : null
        : null;
    return bundle.rowPageOrder
      .map((pageId) => pages[pageId])
      .filter((page): page is Page => Boolean(page && page.dbCells?._qn_isTemplate !== "1"))
      .filter((page) => matchesSchedulerScope(page, mode, selectedProjectId, pages))
      .filter((page) => {
        if (mode !== "feature" || !milestoneFilterSet) return true;
        return schedulerPageLinkIncludes(page.dbCells?.[LC_FEATURE_COLUMN_IDS.milestone], milestoneFilterSet);
      })
      .map((page) => ({
        page,
        cards: mode === "milestone"
          ? milestoneCards(page, columnsById)
          : featureCards(page, columnsById),
      }));
  }, [bundle, milestoneDb, mode, pages, selectedFeatureMilestoneIds, selectedProjectId]);

  const { slots, weekBlocks, mondays, slotCount } = useMemo(() => {
    if (viewMode === "month") {
      const monthStart = startOfDay(new Date(currentYear, monthIndex, 1));
      const monthSlots = buildMonthDaySlots(currentYear, monthIndex);
      return {
        slots: monthSlots,
        weekBlocks: [],
        mondays: [monthStart, monthStart, monthStart] as const,
        slotCount: monthSlots.length,
      };
    }

    if (viewMode === "week") {
      const now = new Date();
      const thisWeekStart = addWeeks(startOfWeek(now), weekOffset);
      const lastWeekStart = subDays(thisWeekStart, 7);
      const nextWeekStart = addWeeks(thisWeekStart, 1);
      const rangeMondays = [
        startOfDay(lastWeekStart),
        startOfDay(thisWeekStart),
        startOfDay(nextWeekStart),
      ] as const;
      const weekSlots = buildWeekDaySlots(rangeMondays[0], rangeMondays[1], rangeMondays[2]);
      const blocks = rangeMondays.map((monday, weekIndex) => {
        const friday = addDays(monday, 4);
        const relativeOffset = weekOffset + weekIndex - 1;
        return {
          key: `${relativeOffset}:${monday.toISOString()}`,
          title: relativeWeekTitle(relativeOffset),
          subtitle: `${fmtMD(monday)} - ${fmtMD(friday)} (월-금)`,
          weekIndex: weekIndex as 0 | 1 | 2,
        };
      });
      return { slots: weekSlots, weekBlocks: blocks, mondays: rangeMondays, slotCount: weekSlots.length };
    }

    return { slots: [], weekBlocks: [], mondays: [] as unknown as readonly [Date, Date, Date], slotCount: 0 };
  }, [currentYear, monthIndex, viewMode, weekOffset]);

  const holidayData = useMemo(() => {
    const holidayMap = new Map<number, string>();
    const holidayTimeSet = new Set<number>();
    const years = new Set([currentYear - 1, currentYear, currentYear + 1]);
    for (const year of years) {
      for (const holiday of getHolidaysForYear(year)) {
        const date = startOfDay(new Date(`${holiday.date}T00:00:00`));
        holidayMap.set(date.getTime(), holiday.name);
        holidayTimeSet.add(date.getTime());
      }
    }
    for (const holiday of storeHolidays) {
      const date = startOfDay(new Date(`${holiday.date}T00:00:00`));
      if (!holidayMap.has(date.getTime())) {
        holidayMap.set(date.getTime(), holiday.title);
        holidayTimeSet.add(date.getTime());
      }
    }
    return { holidayMap, holidayTimeSet };
  }, [currentYear, storeHolidays]);

  const todaySlotIndex = useMemo(() => {
    if (isAnnualView) return null;
    const today = startOfDay(new Date());
    const idx = slots.findIndex((slot) => isSameDay(slot.date, today));
    if (idx >= 0) return idx;
    if (viewMode === "month") return null;
    const thisMonday = startOfWeek(today);
    const weekIdx = mondays.findIndex((monday) => isSameDay(monday, thisMonday));
    if (weekIdx >= 0) return weekIdx * 5 + 4;
    const from = mondays[0];
    const to = addDays(mondays[2], 6);
    if (!from || !to) return null;
    const outOfRange = differenceInCalendarDays(today, from) < 0 || differenceInCalendarDays(today, to) > 0;
    return outOfRange ? null : 4;
  }, [isAnnualView, mondays, slots, viewMode]);

  const rangeCellWidth = slotCount > 0 ? rangeTimelineWidth / slotCount : rangeTimelineWidth;
  const activeCellWidth = isAnnualView ? annualCellWidth : rangeCellWidth;
  const activeTimelineWidth = isAnnualView ? annualTotalWidth : rangeTimelineWidth;

  const titleColumnName =
    bundle?.columns.find((column) => column.type === "title")?.name ??
    (mode === "milestone" ? "마일스톤" : "피처");
  const rowsHeight = rows.length * rowHeight;
  const fixedColumnHeight = DATE_AXIS_HEIGHT + rowsHeight;
  const contentHeight = DATE_AXIS_HEIGHT + rowsHeight + BOTTOM_SPACER_HEIGHT;

  useEffect(() => {
    if (isAnnualView || !containerRef.current) return;
    const element = containerRef.current;
    const updateWidth = () => {
      setRangeTimelineWidth(Math.max(720, element.clientWidth - ITEM_COLUMN_WIDTH));
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [isAnnualView]);

  const scrollToToday = useCallback(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    if (isAnnualView) {
      if (todayIdx === null) return;
      const target = ITEM_COLUMN_WIDTH + todayIdx * annualCellWidth - container.clientWidth / 2;
      container.scrollLeft = Math.max(0, target);
      return;
    }
    if (todaySlotIndex === null) return;
    const target = ITEM_COLUMN_WIDTH + todaySlotIndex * rangeCellWidth - container.clientWidth / 2;
    container.scrollLeft = Math.max(0, target);
  }, [annualCellWidth, isAnnualView, rangeCellWidth, todayIdx, todaySlotIndex]);

  useEffect(() => {
    const handleScrollToday = () => {
      const today = new Date();
      if (viewMode === "month") {
        setCurrentYear(today.getFullYear());
        setMonthIndex(today.getMonth());
      } else if (viewMode === "week") {
        setWeekOffset(0);
      }
      window.requestAnimationFrame(scrollToToday);
    };
    window.addEventListener("lc-scheduler:scroll-today", handleScrollToday);
    return () => window.removeEventListener("lc-scheduler:scroll-today", handleScrollToday);
  }, [scrollToToday, setCurrentYear, viewMode]);

  useEffect(() => {
    const id = window.requestAnimationFrame(scrollToToday);
    return () => window.cancelAnimationFrame(id);
  }, [currentYear, mode, scrollToToday, viewMode]);

  // 리스트 행 클릭: 첫 카드가 보이도록 뷰 범위를 맞추고 스크롤 대기 상태로 진입
  const handleRowFocus = useCallback(
    (row: TimelineRow) => {
      const card = row.cards[0];
      if (card) {
        if (viewMode === "month") {
          setCurrentYear(card.start.getFullYear());
          setMonthIndex(card.start.getMonth());
        } else if (viewMode === "week") {
          const offset = Math.round(
            differenceInCalendarDays(startOfWeek(card.start), startOfWeek(new Date())) / 7,
          );
          setWeekOffset(offset);
        } else {
          setCurrentYear(card.start.getFullYear());
        }
      }
      setPendingFocusPageId(row.page.id);
    },
    [setCurrentYear, viewMode],
  );

  // 뷰 범위 반영 후 해당 행/카드로 스크롤 (수직: 행 중앙, 수평: 첫 카드 시작)
  useEffect(() => {
    if (!pendingFocusPageId) return;
    const container = containerRef.current;
    const rowIndex = container
      ? rows.findIndex((r) => r.page.id === pendingFocusPageId)
      : -1;
    if (!container || rowIndex < 0) {
      setPendingFocusPageId(null);
      return;
    }
    const row = rows[rowIndex];
    if (!row) {
      setPendingFocusPageId(null);
      return;
    }
    const rowTop = DATE_AXIS_HEIGHT + rowIndex * rowHeight;
    container.scrollTop = Math.max(0, rowTop - container.clientHeight / 2 + rowHeight / 2);

    const card = row.cards[0];
    if (card) {
      let cardLeft: number | null = null;
      if (isAnnualView) {
        const visibleRange = clampVisibleRange(currentYear, card.start, card.end);
        if (visibleRange) cardLeft = visibleRange.startIdx * annualCellWidth + CARD_MARGIN;
      } else {
        const slotRange = getCardSlotRange(card, slots);
        if (slotRange) cardLeft = slotRange.startSlot * activeCellWidth + CARD_MARGIN;
      }
      if (cardLeft !== null) {
        container.scrollLeft = Math.max(0, ITEM_COLUMN_WIDTH + cardLeft - container.clientWidth / 2);
      }
    }
    setPendingFocusPageId(null);
  }, [
    pendingFocusPageId,
    rows,
    slots,
    isAnnualView,
    currentYear,
    annualCellWidth,
    activeCellWidth,
    rowHeight,
  ]);

  return (
    <div ref={containerRef} className="flex-1 overflow-auto bg-zinc-50 dark:bg-zinc-950">
      <div
        className="relative"
        style={{
          width: ITEM_COLUMN_WIDTH + activeTimelineWidth,
          minWidth: ITEM_COLUMN_WIDTH + activeTimelineWidth,
          minHeight: contentHeight,
        }}
      >
        <div
          className="sticky left-0 z-20 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800"
          style={{ width: ITEM_COLUMN_WIDTH, height: fixedColumnHeight }}
        >
          <div
            className="sticky top-0 z-30 flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200"
            style={{ height: DATE_AXIS_HEIGHT }}
          >
            {mode === "milestone" ? (
              <Database className="w-4 h-4 text-zinc-500" />
            ) : (
              <Layers className="w-4 h-4 text-zinc-500" />
            )}
            <span className="truncate">{titleColumnName}</span>
          </div>
          {rows.map((row) => (
            <div
              key={row.page.id}
              role="button"
              tabIndex={0}
              onClick={() => handleRowFocus(row)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  handleRowFocus(row);
                }
              }}
              className="group flex w-full cursor-pointer items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 px-3 text-left text-sm text-zinc-900 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800/70"
              style={{ height: rowHeight }}
              title="클릭하여 일정 카드로 이동"
            >
              <PageIconDisplay icon={row.page.icon ?? null} size="sm" />
              <span className="min-w-0 flex-1 truncate">{row.page.title || "제목 없음"}</span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  openPeek(row.page.id);
                }}
                className="shrink-0 rounded p-1 text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-100 hover:text-zinc-700 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                aria-label="피커뷰로 열기"
                title="피커뷰로 열기"
              >
                <PanelRight size={14} />
              </button>
            </div>
          ))}
        </div>

        <div
          className="absolute top-0"
          style={{ left: ITEM_COLUMN_WIDTH, width: activeTimelineWidth, minWidth: activeTimelineWidth }}
        >
          {isAnnualView ? (
            <DateAxis year={currentYear} cellWidth={annualCellWidth} />
          ) : (
            <div
              className="sticky top-0 z-30 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800"
              style={{ height: DATE_AXIS_HEIGHT, width: activeTimelineWidth }}
            >
              {viewMode === "month" ? (
                <div className="h-10 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMonthIndex((value) => {
                        const next = value - 1;
                        if (next < 0) {
                          setCurrentYear(currentYear - 1);
                          return 11;
                        }
                        return next;
                      });
                    }}
                    className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    aria-label="이전 월"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <div className="min-w-[96px] text-center text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {monthIndex + 1}월
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMonthIndex((value) => {
                        const next = value + 1;
                        if (next > 11) {
                          setCurrentYear(currentYear + 1);
                          return 0;
                        }
                        return next;
                      });
                    }}
                    className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    aria-label="다음 월"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              ) : (
                <div
                  className="grid border-b border-zinc-200 dark:border-zinc-800"
                  style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", height: 40 }}
                >
                  {weekBlocks.map((block) => (
                    <div
                      key={block.key}
                      className="text-center border-r border-zinc-200 dark:border-zinc-800 last:border-r-0 flex items-center justify-center gap-1.5 px-1"
                    >
                      {block.weekIndex === 0 && (
                        <button
                          type="button"
                          onClick={() => setWeekOffset((value) => value - 1)}
                          className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          aria-label="이전 주"
                        >
                          <ChevronLeft size={16} />
                        </button>
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{block.title}</div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-tight px-1 truncate">
                          {block.subtitle}
                        </div>
                      </div>
                      {block.weekIndex === 2 && (
                        <button
                          type="button"
                          onClick={() => setWeekOffset((value) => value + 1)}
                          className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          aria-label="다음 주"
                        >
                          <ChevronRight size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="grid" style={{ gridTemplateColumns: `repeat(${slotCount}, minmax(0, 1fr))`, height: 36 }}>
                {slots.map((slot, index) => {
                  const holidayText = holidayData.holidayMap.get(startOfDay(slot.date).getTime());
                  const isHoliday = holidayData.holidayTimeSet.has(startOfDay(slot.date).getTime());
                  const isMonthWeekend = viewMode === "month" && (slot.date.getDay() === 0 || slot.date.getDay() === 6);
                  return (
                    <div
                      key={`${slot.date.getTime()}-${index}`}
                      className="text-[10px] text-center border-r border-zinc-200/60 dark:border-zinc-800/60 last:border-r-0 text-zinc-500 dark:text-zinc-400 leading-tight flex flex-col items-center justify-center"
                      style={{
                        backgroundColor: isHoliday || isMonthWeekend ? weekendColor : "transparent",
                        ...(viewMode === "month" && slot.weekBoundaryBefore
                          ? { borderLeft: "2px dotted rgba(113, 113, 122, 0.75)" }
                          : {}),
                      }}
                      title={holidayText || undefined}
                    >
                      <div className="font-medium text-zinc-900/80 dark:text-zinc-100/80">{fmtDow(slot.date)}</div>
                      <div className="tabular-nums">{fmtMD(slot.date)}</div>
                      {holidayText ? (
                        <div className="text-[9px] leading-tight text-red-600 dark:text-red-400 truncate px-0.5 max-w-full">
                          {holidayText}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {!isAnnualView && todaySlotIndex !== null && (
            <div
              className="absolute bg-blue-500 z-10 pointer-events-none"
              style={{
                top: DATE_AXIS_HEIGHT,
                height: rows.length > 0 ? rowsHeight : rowHeight,
                left: todaySlotIndex * rangeCellWidth + rangeCellWidth / 2 - 2,
                width: 4,
                boxShadow: "0 0 8px rgba(59,130,246,0.6)",
              }}
            />
          )}
          {rows.length === 0 ? (
            <div
              className="flex items-center justify-center border-b border-zinc-200 dark:border-zinc-800 text-sm text-zinc-500 dark:text-zinc-400"
              style={{ height: rowHeight, width: activeTimelineWidth }}
            >
              등록된 {mode === "milestone" ? "마일스톤" : "피처"}가 없습니다.
            </div>
          ) : (
            rows.map((row) => (
              <div
                key={row.page.id}
                className="relative border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950"
                style={{ height: rowHeight, width: activeTimelineWidth }}
              >
                {isAnnualView ? (
                  <GridRow year={currentYear} cellWidth={annualCellWidth} weekendColor={weekendColor} />
                ) : (
                  <div
                    className="absolute inset-0 grid pointer-events-none"
                    style={{ gridTemplateColumns: `repeat(${slotCount}, minmax(0, 1fr))` }}
                  >
                    {slots.map((slot, index) => {
                      const key = startOfDay(slot.date).getTime();
                      const isHoliday = holidayData.holidayTimeSet.has(key);
                      const isMonthWeekend = viewMode === "month" && (slot.date.getDay() === 0 || slot.date.getDay() === 6);
                      return (
                        <div
                          key={`${row.page.id}:bg:${index}`}
                          className="border-r border-zinc-200/40 dark:border-zinc-800/40 last:border-r-0"
                          style={{
                            backgroundColor: isHoliday || isMonthWeekend ? weekendColor : "transparent",
                            ...(viewMode === "month" && slot.weekBoundaryBefore
                              ? { borderLeft: "2px dotted rgba(113, 113, 122, 0.75)" }
                              : {}),
                          }}
                        />
                      );
                    })}
                  </div>
                )}
                {row.cards.map((card) => {
                  const visibleRange = isAnnualView
                    ? clampVisibleRange(currentYear, card.start, card.end)
                    : null;
                  const slotRange = !isAnnualView ? getCardSlotRange(card, slots) : null;
                  if (isAnnualView && !visibleRange) return null;
                  if (!isAnnualView && !slotRange) return null;
                  const left = isAnnualView && visibleRange
                    ? visibleRange.startIdx * annualCellWidth + CARD_MARGIN
                    : (slotRange?.startSlot ?? 0) * activeCellWidth + CARD_MARGIN;
                  const width = isAnnualView && visibleRange
                    ? Math.max(
                      24,
                      (visibleRange.endIdx - visibleRange.startIdx + 1) * annualCellWidth - CARD_MARGIN * 2,
                    )
                    : Math.max(
                      24,
                      ((slotRange?.endSlot ?? 0) - (slotRange?.startSlot ?? 0) + 1) * activeCellWidth - CARD_MARGIN * 2,
                    );
                  return (
                    <button
                      key={card.id}
                      type="button"
                      onDoubleClick={() => openPeek(card.pageId)}
                      className="absolute rounded-md px-2 text-left text-xs font-semibold shadow-sm transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-blue-500"
                      style={{
                        left,
                        top: ROW_PADDING_TOP,
                        width,
                        height: cardHeight,
                        backgroundColor: card.color,
                        color: pickTextColor(card.color),
                      }}
                      title="더블클릭하여 항목 열기"
                    >
                      <span className="block truncate">{card.title}</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
