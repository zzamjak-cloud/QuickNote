// LC 마일스톤/피처 DB 행을 스케줄러 타임라인으로 투영하고 행 순서를 조정하는 뷰.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronLeft, ChevronRight, Database, GripVertical, Layers, PanelRight, Plus } from "lucide-react";
import { Rnd } from "react-rnd";
import { useDatabaseStore } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseRowIndexStore } from "../../store/databaseRowIndexStore";
import { useSchedulerViewStore, type SchedulerEntityMode } from "../../store/schedulerViewStore";
import { useUiStore } from "../../store/uiStore";
import { emptyPanelState, getVisibleOrderedColumns, resolveViewColumnOrderState, type CellValue, type ColumnDef } from "../../types/database";
import type { Page } from "../../types/page";
import type { DatabaseRowIndexEntry } from "../../lib/database/databaseRowIndexCache";
import { resolveDatabaseRowRemoteKey } from "../../lib/sync/externalProtectedDatabaseLoad";
import { ensurePageContentLoaded } from "../../lib/sync/pageContentLoad";
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
import { animateScroll } from "../../lib/animateScroll";
import { resolveActiveFilterRules } from "../../lib/databaseQuery";
import { CARD_MARGIN, getCellWidth, getRowHeight, getScheduleCardHeight, getScheduleCardVOffset } from "../../lib/scheduler/grid";
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
import { DatabaseColumnSettingsButton } from "../database/DatabaseColumnSettingsButton";
import { TimelineCardPropertyLabels } from "../database/TimelineCardPropertyLabels";
import { TimelineCardText } from "../database/TimelineCardText";
import { applyTimelineCardStickyOffset } from "../database/timelineCardStickyOffset";
import { getScheduleCardContentOffset } from "./scheduleCardDisplay";
import { ScheduleCardDetailRows } from "../database/ScheduleCardDetailRows";
import { ContextMenu, announceSchedulerContextMenuOpen } from "./ContextMenu";
import { useDoubleTapByKey } from "../../hooks/useDoubleTap";
import {
  makeTimelineCardColorOverrides,
  resolveTimelineCardColor,
  TIMELINE_CARD_COLOR_OVERRIDES_CELL_ID,
} from "../../lib/database/timelineCardColor";
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

// 항목 선택 시 포커싱 스크롤 지속 시간(ms). 0.3초 동안 부드럽게 이동.
const FOCUS_SCROLL_DURATION_MS = 300;
const DATE_AXIS_HEIGHT = 76;
const DEFAULT_ITEM_COLUMN_WIDTH = 220;
const BOTTOM_SPACER_HEIGHT = 220;
const ADD_ITEM_ROW_HEIGHT = 44;
const TIMELINE_CARD_COLORS = ["#2563eb", "#9333ea", "#f59e0b", "#dc2626", "#16a34a"];

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
  columnId: string;
  columnName: string;
  title: string;
  start: Date;
  end: Date;
  dateLabel: string;
  showDateLabel: boolean;
  color: string;
};

type ContextPointerEvent = {
  button?: number;
  clientX: number;
  clientY: number;
  preventDefault: () => void;
  stopPropagation: () => void;
};

type TimelineRow = {
  page: Page;
  cards: TimelineCard[];
};

type SchedulerTimelineDateEntry = {
  columnId: string;
  columnName: string;
  titleMode: "pageTitle" | "custom";
  title: string;
  color: string;
  isPrimary: boolean;
};

type SortableTimelineLabelRowProps = {
  row: TimelineRow;
  rowHeight: number;
  onFocus: (row: TimelineRow) => void;
  onOpenPeek: (pageId: string) => void;
};

function SortableTimelineLabelRow({
  row,
  rowHeight,
  onFocus,
  onOpenPeek,
}: SortableTimelineLabelRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.page.id });

  return (
    <div
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      onClick={() => onFocus(row)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onFocus(row);
        }
      }}
      className={`group flex w-full cursor-pointer items-center gap-2 border-b border-zinc-200 px-3 text-left text-sm text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-800/70 ${
        isDragging ? "bg-zinc-100 shadow-sm dark:bg-zinc-800" : ""
      }`}
      style={{
        height: rowHeight,
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 40 : undefined,
      }}
      title="클릭하여 일정 카드로 이동"
    >
      <span
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 active:cursor-grabbing dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        aria-label={`${row.page.title || "제목 없음"} 순서 변경`}
      >
        <GripVertical size={14} />
      </span>
      <PageIconDisplay icon={row.page.icon ?? null} size="sm" />
      <span className="min-w-0 flex-1 truncate">{row.page.title || "제목 없음"}</span>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpenPeek(row.page.id);
        }}
        className="shrink-0 rounded p-1 text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-100 hover:text-zinc-700 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        aria-label="피커뷰로 열기"
        title="피커뷰로 열기"
      >
        <PanelRight size={14} />
      </button>
    </div>
  );
}

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

function formatCardDateLabel(range: DateRange): string {
  return `${fmtMD(range.start)} ~ ${fmtMD(range.end)}`;
}

// 날짜 셀에 저장할 YYYY-MM-DD 문자열.
function toDateCellIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isValidTimelineColor(value: string | undefined): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function defaultTimelineColor(index: number): string {
  return TIMELINE_CARD_COLORS[index % TIMELINE_CARD_COLORS.length] ?? "#16a34a";
}

function mergeRowPageOrderWithIndex(
  rowPageOrder: readonly string[],
  rowIndexRows: readonly DatabaseRowIndexEntry[],
): string[] {
  if (rowIndexRows.length === 0) return [...rowPageOrder];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of rowIndexRows) {
    if (seen.has(row.pageId)) continue;
    seen.add(row.pageId);
    ids.push(row.pageId);
  }
  for (const pageId of rowPageOrder) {
    if (seen.has(pageId)) continue;
    seen.add(pageId);
    ids.push(pageId);
  }
  return ids;
}

function rowIndexEntryToPage(row: DatabaseRowIndexEntry): Page {
  return {
    id: row.pageId,
    workspaceId: row.workspaceId,
    title: row.title,
    icon: row.icon,
    doc: { type: "doc", content: [] },
    parentId: null,
    order: row.order,
    createdAt: row.updatedAt,
    updatedAt: row.updatedAt,
    databaseId: row.databaseId,
    dbCells: row.dbCells,
    contentLoaded: false,
  };
}

function resolveCardTitle(
  page: Page,
  column: ColumnDef | undefined,
  fallback: string,
  _usePageTitle: boolean,
): string {
  const config = column?.config?.timelineCard;
  if (config?.titleMode === "pageTitle") return (page.title ?? "").trim() || "제목 없음";
  if (config?.titleMode === "custom") return config.title?.trim() || fallback;
  return (page.title ?? "").trim() || "제목 없음";
}

function resolveCardColor(column: ColumnDef | undefined, fallback: string): string {
  return column?.config?.timelineCard?.color ?? fallback;
}

function databaseTimelineCards(
  page: Page,
  entries: SchedulerTimelineDateEntry[],
  columnsById: Map<string, ColumnDef>,
): TimelineCard[] {
  const cells = page.dbCells ?? {};
  return entries.flatMap((entry) => {
    const column = columnsById.get(entry.columnId);
    if (column?.config?.timelineCard?.enabled === false) return [];
    let range = readDateRange(cells[entry.columnId]);
    if (!range && entry.columnId === LC_FEATURE_COLUMN_IDS.workStart) {
      range = readDateRange(cells[LC_FEATURE_COLUMN_IDS.workEnd]);
    }
    if (!range) return [];
    return [
      {
        id: `${page.id}:${entry.columnId}`,
        pageId: page.id,
        columnId: entry.columnId,
        columnName: column?.name ?? entry.columnName,
        title: resolveCardTitle(page, column, entry.title || entry.columnName, true),
        start: range.start,
        end: range.end,
        dateLabel: formatCardDateLabel(range),
        showDateLabel: true,
        color: resolveTimelineCardColor(cells, entry.columnId, resolveCardColor(column, entry.color)),
      },
    ];
  });
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
  // 진행 중인 포커싱 스크롤 애니메이션 핸들 + 진행 여부 플래그.
  // 애니메이션 중에는 onScroll 의 setTrackScrollLeft(전체 행/카드 리렌더)를 멈춰 프레임을 매끄럽게 한다.
  const focusScrollRef = useRef<{ cancel: () => void } | null>(null);
  const focusAnimatingRef = useRef(false);
  useEffect(() => () => focusScrollRef.current?.cancel(), []);
  const milestoneDatabaseId = makeLCMilestoneDatabaseId(workspaceId);
  const featureDatabaseId = makeLCFeatureDatabaseId(workspaceId);
  const databaseId =
    mode === "milestone"
      ? milestoneDatabaseId
      : featureDatabaseId;
  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const milestoneDb = useDatabaseStore((s) => s.databases[milestoneDatabaseId]);
  const setRowOrder = useDatabaseStore((s) => s.setRowOrder);
  const addRow = useDatabaseStore((s) => s.addRow);
  const updateCell = useDatabaseStore((s) => s.updateCell);
  const patchDatabasePanelState = useDatabaseStore((s) => s.patchDatabasePanelState);
  const selectedFeatureMilestoneIds =
    useDatabaseStore((s) => s.databases[featureDatabaseId]?.panelState?.schedulerFeatureMilestoneIds) ??
    null;
  const pages = usePageStore((s) => s.pages);
  const openPeek = useUiStore((s) => s.openPeek);
  const showToast = useUiStore((s) => s.showToast);
  const viewMode = useSchedulerViewStore((s) => s.viewMode);
  const zoomLevel = useSchedulerViewStore((s) => s.zoomLevel);
  const columnWidthScale = useSchedulerViewStore((s) => s.columnWidthScale);
  const itemColumnWidth =
    useSchedulerViewStore((s) => s.databaseTimelineItemColumnWidth) ??
    DEFAULT_ITEM_COLUMN_WIDTH;
  const setItemColumnWidth = useSchedulerViewStore(
    (s) => s.setDatabaseTimelineItemColumnWidth,
  );
  const currentYear = useSchedulerViewStore((s) => s.currentYear);
  const setCurrentYear = useSchedulerViewStore((s) => s.setCurrentYear);
  const selectedProjectId = useSchedulerViewStore((s) => s.selectedProjectId);
  const selectedMemberId = useSchedulerViewStore((s) => s.selectedMemberId);
  const weekendColor = useSchedulerViewStore((s) => s.weekendColor);
  const storeHolidays = useSchedulerHolidaysStore((s) => s.holidays);
  // 피처는 unscoped(전체) 로드 후 클라에서 마일스톤 scope 로 필터(아래 matchesSchedulerScope)하므로
  // 읽기 키도 "inline" 이어야 LCSchedulerModal 의 피처 적재 키와 일치한다. 마일스톤/작업은 scoped.
  const rowIndexKey = resolveDatabaseRowRemoteKey(
    databaseId,
    workspaceId,
    mode === "feature" ? "inline" : "scheduler",
  );
  const milestoneRowIndexKey = resolveDatabaseRowRemoteKey(milestoneDatabaseId, workspaceId, "scheduler");
  const rowIndexScopeSignature = `${selectedProjectId ?? ""}:${selectedMemberId ?? ""}`;
  const hydrateRowIndex = useDatabaseRowIndexStore((s) => s.hydrateIndex);
  useEffect(() => {
    if (rowIndexKey) void hydrateRowIndex(rowIndexKey);
    if (milestoneRowIndexKey && milestoneRowIndexKey !== rowIndexKey) {
      void hydrateRowIndex(milestoneRowIndexKey);
    }
  }, [hydrateRowIndex, milestoneRowIndexKey, rowIndexKey, rowIndexScopeSignature]);
  const rowIndexRows = useDatabaseRowIndexStore(
    (s) => (rowIndexKey ? s.snapshotsByKey[rowIndexKey]?.rows ?? [] : []),
  );
  const milestoneRowIndexRows = useDatabaseRowIndexStore(
    (s) => (milestoneRowIndexKey ? s.snapshotsByKey[milestoneRowIndexKey]?.rows ?? [] : []),
  );
  const [rangeTimelineWidth, setRangeTimelineWidth] = useState(900);
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthIndex, setMonthIndex] = useState(() => new Date().getMonth());
  const rowSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  // 리스트 클릭 시 해당 행/카드로 스크롤하기 위한 대기 상태 (뷰 범위 변경 후 다음 렌더에서 처리)
  const [pendingFocusPageId, setPendingFocusPageId] = useState<string | null>(null);
  // 카드 호버 툴팁 — 표시 설정 속성을 작업 카드와 동일하게 보여준다.
  const [hoveredCard, setHoveredCard] = useState<{
    pageId: string;
    title: string;
    columnName: string;
    dateLabel: string;
    left: number;
    top: number;
    placeAbove: boolean;
  } | null>(null);
  const [cardColorMenu, setCardColorMenu] = useState<{
    left: number;
    top: number;
    pageId: string;
    columnId: string;
    currentColor: string;
  } | null>(null);
  // 가로 스크롤 위치 — 날짜 미등록(흰색) 카드를 항목 컬럼 우측에 고정해 따라다니게 한다.
  const [trackScrollLeft, setTrackScrollLeft] = useState(0);

  const isAnnualView = viewMode === "year";
  const annualCellWidth = getCellWidth(zoomLevel, columnWidthScale);
  const total = daysInYear(currentYear);
  const annualTotalWidth = total * annualCellWidth;
  const rowHeight = getRowHeight(1, zoomLevel);
  // 카드 높이는 모든 뷰·탭 공통 헬퍼로 통일(22~30px), 행 높이 중앙 배치.
  const cardHeight = getScheduleCardHeight(rowHeight);
  const cardTop = getScheduleCardVOffset(rowHeight, cardHeight);
  const todayIdx = calcTodayIndex(currentYear);
  // 날짜 컬럼을 표시설정(viewConfigs.timeline) 순서대로 정렬 → 첫 포커싱 대상이 표시 순서를 따른다.
  const dateCols = useMemo(() => {
    if (!bundle) return [] as ColumnDef[];
    const all = bundle.columns.filter((column) => column.type === "date");
    const orderedIds = resolveViewColumnOrderState(
      bundle.columns,
      "timeline",
      bundle.panelState?.viewConfigs?.timeline,
    ).orderedColumnIds;
    const rank = new Map(orderedIds.map((id, index) => [id, index]));
    return [...all].sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [bundle]);
  const primaryDateCol = useMemo(
    () =>
      dateCols.find((column) => column.id === bundle?.panelState?.timelineDateColumnId) ??
      dateCols[0] ??
      null,
    [bundle?.panelState?.timelineDateColumnId, dateCols],
  );
  const hasExplicitTimelineCards = useMemo(
    () => dateCols.some((column) => column.config?.timelineCard?.enabled === true),
    [dateCols],
  );
  const timelineDateEntries = useMemo<SchedulerTimelineDateEntry[]>(() => {
    const activeColumns = hasExplicitTimelineCards
      ? dateCols.filter((column) => column.config?.timelineCard?.enabled === true)
      : primaryDateCol && primaryDateCol.config?.timelineCard?.enabled !== false
        ? [primaryDateCol]
        : [];
    return activeColumns.map((column, index) => {
      const config = column.config?.timelineCard;
      return {
        columnId: column.id,
        columnName: column.name,
        titleMode: config?.titleMode === "custom" ? "custom" : "pageTitle",
        title: typeof config?.title === "string" ? config.title : "",
        color: isValidTimelineColor(config?.color) ? config.color : defaultTimelineColor(index),
        isPrimary: column.id === primaryDateCol?.id || (!primaryDateCol && index === 0),
      };
    });
  }, [dateCols, hasExplicitTimelineCards, primaryDateCol]);
  const activeDateColumnIds = useMemo(
    () => new Set(timelineDateEntries.map((entry) => entry.columnId)),
    [timelineDateEntries],
  );
  // 일반 DB 타임라인과 동일 규칙 — 설정 없으면 전체 표시. LC 스케줄러 DB도 컬럼 표시/순서를
  // 동일하게 따른다(차이는 DB 삭제 불가뿐).
  const visibleTimelineColumnIdSet = useMemo(
    () =>
      bundle
        ? new Set(
            getVisibleOrderedColumns(bundle.columns, "timeline", bundle.panelState?.viewConfigs)
              .map((column) => column.id),
          )
        : null,
    [bundle],
  );
  // 카드 라벨에서 제외할 활성 날짜 컬럼 목록 (타임라인 막대로 쓰임) — 공용 라벨 컴포넌트에 전달.
  const activeDateColumnIdList = useMemo(
    () => [...activeDateColumnIds],
    [activeDateColumnIds],
  );
  const rowPageOrder = useMemo(
    () => mergeRowPageOrderWithIndex(bundle?.rowPageOrder ?? [], rowIndexRows),
    [bundle?.rowPageOrder, rowIndexRows],
  );
  const milestoneRowPageOrder = useMemo(
    () => mergeRowPageOrderWithIndex(milestoneDb?.rowPageOrder ?? [], milestoneRowIndexRows),
    [milestoneDb?.rowPageOrder, milestoneRowIndexRows],
  );
  const schedulerPages = useMemo(() => {
    const next: Record<string, Page> = { ...pages };
    for (const row of milestoneRowIndexRows) {
      if (!next[row.pageId]) next[row.pageId] = rowIndexEntryToPage(row);
    }
    for (const row of rowIndexRows) {
      if (!next[row.pageId]) next[row.pageId] = rowIndexEntryToPage(row);
    }
    return next;
  }, [milestoneRowIndexRows, pages, rowIndexRows]);
  const openTimelineRow = useCallback(
    async (pageId: string, source = "lc-scheduler-timeline-open") => {
      const page = schedulerPages[pageId];
      const loaded = await ensurePageContentLoaded({
        pageId,
        workspaceId: page?.workspaceId ?? workspaceId,
        source,
      });
      if (!loaded) {
        showToast("항목 페이지를 불러오지 못했습니다.", { kind: "error" });
        return false;
      }
      return true;
    },
    [schedulerPages, showToast, workspaceId],
  );
  const openTimelineRowPeek = useCallback(
    async (pageId: string) => {
      const loaded = await openTimelineRow(pageId);
      if (!loaded) return;
      openPeek(pageId);
    },
    [openPeek, openTimelineRow],
  );

  // 터치 더블탭 → 카드 피크. Rnd(react-draggable)가 touchstart 를 preventDefault 해
  // 합성 dblclick 이 안 생기므로 터치는 별도 감지가 필요하다.
  // 카드는 map 렌더라 카드별 훅 호출이 불가 → pageId 키 기반 공용 감지기 1개 사용.
  const cardDoubleTap = useDoubleTapByKey((pageId) => {
    void openTimelineRowPeek(pageId);
  });

  // 항목(마일스톤/피처) 추가 — DB에 행을 추가하고, 현재 스코프 선택을 기본값으로 적용한 뒤
  // 신규 페이지를 사이드 피커뷰로 띄운다. (DB에서 직접 추가해도 동일 DB라 자동 동기화)
  const handleAddItem = useCallback(() => {
    const seedFilters = bundle?.panelState
      ? resolveActiveFilterRules(bundle.panelState)
      : undefined;
    const newPageId = addRow(databaseId, seedFilters);
    if (!newPageId) return;
    if (selectedProjectId) {
      const colIds = mode === "milestone" ? LC_MILESTONE_COLUMN_IDS : LC_FEATURE_COLUMN_IDS;
      if (selectedProjectId.startsWith("org:")) {
        updateCell(databaseId, newPageId, colIds.organization, selectedProjectId.slice(4));
      } else if (selectedProjectId.startsWith("team:")) {
        updateCell(databaseId, newPageId, colIds.team, selectedProjectId.slice(5));
      } else if (selectedProjectId.startsWith("proj:")) {
        updateCell(databaseId, newPageId, colIds.project, selectedProjectId.slice(5));
      }
    }
    openPeek(newPageId);
  }, [addRow, bundle, databaseId, mode, selectedProjectId, updateCell, openPeek]);

  const rows = useMemo<TimelineRow[]>(() => {
    if (!bundle) return [];
    const columnsById = new Map(bundle.columns.map((column) => [column.id, column]));
    const scopedMilestoneIds =
      mode === "feature" && selectedProjectId && milestoneDb
        ? getScopedMilestoneIds(milestoneRowPageOrder, schedulerPages, selectedProjectId)
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
    return rowPageOrder
      .map((pageId) => schedulerPages[pageId])
      .filter((page): page is Page => Boolean(page && page.dbCells?._qn_isTemplate !== "1"))
      .filter((page) => matchesSchedulerScope(page, mode, selectedProjectId, schedulerPages))
      .filter((page) => {
        if (mode !== "feature" || !milestoneFilterSet) return true;
        return schedulerPageLinkIncludes(page.dbCells?.[LC_FEATURE_COLUMN_IDS.milestone], milestoneFilterSet);
      })
      .map((page) => {
        const cards = databaseTimelineCards(page, timelineDateEntries, columnsById);
        return {
          page,
          cards: cards.map((card) => ({
            ...card,
            showDateLabel: visibleTimelineColumnIdSet
              ? visibleTimelineColumnIdSet.has(card.columnId)
              : true,
          })),
        };
      });
  }, [
    bundle,
    milestoneDb,
    milestoneRowPageOrder,
    mode,
    rowPageOrder,
    schedulerPages,
    selectedFeatureMilestoneIds,
    selectedProjectId,
    timelineDateEntries,
    visibleTimelineColumnIdSet,
  ]);
  const rowIds = useMemo(() => rows.map((row) => row.page.id), [rows]);

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

  // 날짜 미등록 카드를 드롭한 x 위치 → 기본 날짜 컬럼에 시작=종료 날짜로 기록 (드래그로 일정 확정).
  const commitUnscheduledDate = useCallback(
    async (pageId: string, dropX: number) => {
      if (!primaryDateCol) return;
      let date: Date;
      if (isAnnualView) {
        const maxIdx = daysInYear(currentYear) - 1;
        const dayIdx = Math.max(0, Math.min(maxIdx, Math.round((dropX - CARD_MARGIN) / annualCellWidth)));
        date = addDays(startOfDay(new Date(currentYear, 0, 1)), dayIdx);
      } else {
        if (slots.length === 0) return;
        const idx = Math.max(0, Math.min(slots.length - 1, Math.round((dropX - CARD_MARGIN) / activeCellWidth)));
        date = startOfDay(slots[idx]!.date);
      }
      const iso = toDateCellIso(date);
      const loaded = await openTimelineRow(pageId, "lc-scheduler-timeline-date");
      if (!loaded) return;
      updateCell(databaseId, pageId, primaryDateCol.id, { start: iso, end: iso });
    },
    [
      primaryDateCol,
      isAnnualView,
      currentYear,
      annualCellWidth,
      slots,
      activeCellWidth,
      openTimelineRow,
      updateCell,
      databaseId,
    ],
  );

  // 일정 카드 드래그/리사이즈 → 새 left·width(px) 를 날짜 범위로 변환해 해당 날짜 컬럼에 기록.
  // 작업 일정 카드와 동일하게 가로 드래그(이동)·좌우 핸들(기간 조절)을 지원한다.
  const commitCardRange = useCallback(
    async (card: TimelineCard, leftPx: number, widthPx: number) => {
      const cellW = isAnnualView ? annualCellWidth : activeCellWidth;
      if (cellW <= 0) return;
      const span = Math.max(1, Math.round((widthPx + CARD_MARGIN * 2) / cellW));
      let start: Date;
      let end: Date;
      if (isAnnualView) {
        const maxIdx = daysInYear(currentYear) - 1;
        const startIdx = Math.max(0, Math.min(maxIdx, Math.round((leftPx - CARD_MARGIN) / annualCellWidth)));
        const endIdx = Math.max(startIdx, Math.min(maxIdx, startIdx + span - 1));
        const yearStart = startOfDay(new Date(currentYear, 0, 1));
        start = addDays(yearStart, startIdx);
        end = addDays(yearStart, endIdx);
      } else {
        if (slots.length === 0) return;
        const startSlot = Math.max(0, Math.min(slots.length - 1, Math.round((leftPx - CARD_MARGIN) / activeCellWidth)));
        const endSlot = Math.max(startSlot, Math.min(slots.length - 1, startSlot + span - 1));
        start = startOfDay(slots[startSlot]!.date);
        end = startOfDay(slots[endSlot]!.date);
      }
      const loaded = await openTimelineRow(card.pageId, "lc-scheduler-timeline-range");
      if (!loaded) return;
      updateCell(databaseId, card.pageId, card.columnId, { start: toDateCellIso(start), end: toDateCellIso(end) });
    },
    [isAnnualView, annualCellWidth, activeCellWidth, currentYear, slots, openTimelineRow, updateCell, databaseId],
  );

  const openCardColorMenu = useCallback((event: ContextPointerEvent, card: TimelineCard) => {
    event.preventDefault();
    event.stopPropagation();
    announceSchedulerContextMenuOpen();
    setHoveredCard(null);
    setCardColorMenu({
      left: event.clientX,
      top: event.clientY,
      pageId: card.pageId,
      columnId: card.columnId,
      currentColor: card.color,
    });
  }, []);

  const handleTimelineCardColorChange = useCallback(
    async (color: string) => {
      if (!cardColorMenu || !bundle) return;
      const loaded = await openTimelineRow(cardColorMenu.pageId, "lc-scheduler-timeline-color");
      if (!loaded) return;
      const cells =
        usePageStore.getState().pages[cardColorMenu.pageId]?.dbCells ??
        schedulerPages[cardColorMenu.pageId]?.dbCells;
      updateCell(
        databaseId,
        cardColorMenu.pageId,
        TIMELINE_CARD_COLOR_OVERRIDES_CELL_ID,
        makeTimelineCardColorOverrides(cells, cardColorMenu.columnId, color),
      );
    },
    [bundle, cardColorMenu, databaseId, openTimelineRow, schedulerPages, updateCell],
  );

  useEffect(() => {
    const handleNativeContextMenu = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest("[data-scheduler-db-timeline-card='true']")) {
        event.preventDefault();
      }
    };

    document.addEventListener("contextmenu", handleNativeContextMenu, true);
    return () => document.removeEventListener("contextmenu", handleNativeContextMenu, true);
  }, []);

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
      setRangeTimelineWidth(Math.max(720, element.clientWidth - itemColumnWidth));
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [isAnnualView, itemColumnWidth]);

  const scrollToToday = useCallback(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    if (isAnnualView) {
      if (todayIdx === null) return;
      const target = itemColumnWidth + todayIdx * annualCellWidth - container.clientWidth / 2;
      container.scrollLeft = Math.max(0, target);
      return;
    }
    if (todaySlotIndex === null) return;
    const target = itemColumnWidth + todaySlotIndex * rangeCellWidth - container.clientWidth / 2;
    container.scrollLeft = Math.max(0, target);
  }, [annualCellWidth, isAnnualView, itemColumnWidth, rangeCellWidth, todayIdx, todaySlotIndex]);

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

  const handleRowDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!bundle) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = bundle.rowPageOrder.indexOf(String(active.id));
      const newIndex = bundle.rowPageOrder.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return;

      setRowOrder(databaseId, arrayMove(bundle.rowPageOrder, oldIndex, newIndex));
    },
    [bundle, databaseId, setRowOrder],
  );

  const handleColumnResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = itemColumnWidth;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        setItemColumnWidth(startWidth + moveEvent.clientX - startX);
      };
      const handlePointerUp = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [itemColumnWidth, setItemColumnWidth],
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
    const targetTop = Math.max(0, rowTop - container.clientHeight / 2 + rowHeight / 2);

    let targetLeft: number | undefined;
    const card = row.cards[0];
    if (card) {
      let startCellIndex: number | null = null;
      let cellW = activeCellWidth;
      if (isAnnualView) {
        const visibleRange = clampVisibleRange(currentYear, card.start, card.end);
        if (visibleRange) {
          startCellIndex = visibleRange.startIdx;
          cellW = annualCellWidth;
        }
      } else {
        const slotRange = getCardSlotRange(card, slots);
        if (slotRange) {
          startCellIndex = slotRange.startSlot;
          cellW = activeCellWidth;
        }
      }
      if (startCellIndex !== null) {
        // 시작일 하루 전(셀 1칸)이 타임라인의 첫 셀이 되도록 셀 경계에 정렬한다.
        // 예: 6월 2일 시작 일정이면 6월 1일 셀이 타임라인 첫 칸으로 보인다.
        targetLeft = Math.max(0, (startCellIndex - 1) * cellW);
      }
    }

    // 수직(행 중앙) + 수평(첫 카드)을 0.3초 동안 함께 부드럽게 이동.
    // 카드 내부 텍스트의 sticky 오프셋은 매 프레임 DOM transform 으로 직접 갱신해 부드럽게 따라오게 한다.
    focusScrollRef.current?.cancel();
    focusAnimatingRef.current = true;
    focusScrollRef.current = animateScroll(
      container,
      { left: targetLeft, top: targetTop },
      FOCUS_SCROLL_DURATION_MS,
      () => {
        focusAnimatingRef.current = false;
        // 종료 후 sticky 오프셋·"날짜 없음" 카드 위치(trackScrollLeft) 를 한 번만 동기화.
        setTrackScrollLeft(container.scrollLeft);
      },
      (pos) => applyTimelineCardStickyOffset(container, pos.left),
    );
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
    <>
    <div
      ref={containerRef}
      onScroll={(event) => {
        // 포커싱 애니메이션 중에는 setTrackScrollLeft(전체 행/카드 리렌더)를 건너뛴다.
        if (focusAnimatingRef.current) return;
        setTrackScrollLeft(event.currentTarget.scrollLeft);
      }}
      className="flex-1 overflow-auto bg-zinc-50 dark:bg-zinc-950"
    >
      <div
        className="relative"
        style={{
          width: itemColumnWidth + activeTimelineWidth,
          minWidth: itemColumnWidth + activeTimelineWidth,
          minHeight: contentHeight,
        }}
      >
        <div
          className="sticky left-0 z-20 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800"
          style={{ width: itemColumnWidth, height: fixedColumnHeight }}
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
            <div className="ml-auto shrink-0">
              <DatabaseColumnSettingsButton
                databaseId={databaseId}
                viewKind="timeline"
                panelState={bundle?.panelState ?? emptyPanelState()}
                setPanelState={(patch) => patchDatabasePanelState(databaseId, patch)}
                // LC 스케줄러 모달(z-[500]) 내부라 팝오버가 뒤로 숨지 않도록 그 위 z-index 사용.
                popoverZClassName="z-[560]"
              />
            </div>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="첫 컬럼 너비 조절"
              onPointerDown={handleColumnResizeStart}
              className="absolute right-[-4px] top-0 z-40 h-full w-2 cursor-col-resize touch-none"
            >
              <div className="mx-auto h-full w-px bg-transparent transition-colors hover:bg-green-500" />
            </div>
          </div>
          <DndContext sensors={rowSensors} collisionDetection={closestCenter} onDragEnd={handleRowDragEnd}>
            <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
              {rows.map((row) => (
                <SortableTimelineLabelRow
                  key={row.page.id}
                  row={row}
                  rowHeight={rowHeight}
                  onFocus={handleRowFocus}
                  onOpenPeek={(pageId) => {
                    void openTimelineRowPeek(pageId);
                  }}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        {/* 항목 추가 — 배경/구분선 없이 텍스트만, 우측 정렬 (항목 컬럼 영역 하단) */}
        <div
          className="sticky left-0 z-20"
          style={{ width: itemColumnWidth, height: ADD_ITEM_ROW_HEIGHT }}
        >
          <button
            type="button"
            onClick={handleAddItem}
            className="flex h-full w-full items-center justify-end gap-1 pr-3 text-right text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
          >
            <Plus size={12} className="shrink-0" />
            {mode === "milestone" ? "마일스톤 추가" : "피처 추가"}
          </button>
        </div>

        <div
          className="absolute top-0"
          style={{ left: itemColumnWidth, width: activeTimelineWidth, minWidth: activeTimelineWidth }}
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
              {mode === "milestone" ? "등록된 마일스톤이 없습니다." : "등록된 피처가 없습니다."}
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
                  const textColor = pickTextColor(card.color);
                  const labelTextColor =
                    textColor === "#ffffff" ? "rgba(255,255,255,0.82)" : "rgba(26,26,26,0.72)";
                  const cellW = isAnnualView ? annualCellWidth : activeCellWidth;
                  // 긴 카드가 좌측으로 스크롤될 때 텍스트를 화면(항목 컬럼 우측) 안에 유지.
                  const contentOffset = getScheduleCardContentOffset({
                    scrollLeft: trackScrollLeft,
                    cardLeft: left,
                    cardWidth: width,
                  });
                  return (
                    <Rnd
                      key={card.id}
                      data-scheduler-db-timeline-card="true"
                      position={{ x: left, y: cardTop }}
                      size={{ width, height: cardHeight }}
                      dragAxis="x"
                      bounds="parent"
                      enableResizing={{
                        left: true,
                        right: true,
                        top: false,
                        bottom: false,
                        topLeft: false,
                        topRight: false,
                        bottomLeft: false,
                        bottomRight: false,
                      }}
                      resizeHandleStyles={{
                        left: { cursor: "ew-resize", width: 8, left: 0 },
                        right: { cursor: "ew-resize", width: 8, right: 0 },
                      }}
                      minWidth={Math.max(16, cellW - CARD_MARGIN * 2)}
                      onDragStop={(_event, data) => {
                        void commitCardRange(card, data.x, width);
                      }}
                      onResizeStop={(_event, _dir, ref, _delta, position) =>
                        void commitCardRange(card, position.x, ref.offsetWidth)
                      }
                      onMouseDown={(event: MouseEvent) => {
                        if (event.button === 2) {
                          openCardColorMenu(event, card);
                        }
                      }}
                      onContextMenu={(event: ReactMouseEvent<HTMLElement>) => openCardColorMenu(event, card)}
                      className="z-[3]"
                    >
                      <div
                        onDoubleClick={() => {
                          void openTimelineRowPeek(card.pageId);
                        }}
                        onTouchStart={(event) => cardDoubleTap.onTouchStart(card.pageId, event)}
                        onTouchEnd={(event) => cardDoubleTap.onTouchEnd(card.pageId, event)}
                        onTouchCancel={cardDoubleTap.onTouchCancel}
                        onMouseDown={(event) => {
                          if (event.button === 2) {
                            openCardColorMenu(event, card);
                          }
                        }}
                        data-scheduler-db-timeline-card="true"
                        onContextMenu={(event) => openCardColorMenu(event, card)}
                        onMouseEnter={(event: ReactMouseEvent<HTMLDivElement>) => {
                          const rect = event.currentTarget.getBoundingClientRect();
                          const placeAbove = rect.top > window.innerHeight - rect.bottom;
                          setHoveredCard({
                            pageId: card.pageId,
                            title: card.title,
                            columnName: card.columnName,
                            dateLabel: card.dateLabel,
                            // 카드 시작점이 아니라 마우스 X 좌표 기준으로 툴팁 위치 설정.
                            left: Math.max(8, Math.min(event.clientX, window.innerWidth - 268)),
                            top: placeAbove ? rect.top - 6 : rect.bottom + 6,
                            placeAbove,
                          });
                        }}
                        onMouseLeave={() => setHoveredCard(null)}
                        className="h-full w-full cursor-grab overflow-hidden rounded-md px-2 text-left text-xs font-semibold shadow-sm active:cursor-grabbing"
                        style={{ backgroundColor: card.color, color: textColor }}
                      >
                        <TimelineCardText
                          cardLeft={left}
                          cardWidth={width}
                          contentOffset={contentOffset}
                          title={card.title}
                          dateLabel={card.showDateLabel ? card.dateLabel : undefined}
                          dateClassName="font-normal"
                          dateStyle={{ color: labelTextColor }}
                          containerClassName="flex h-full items-center gap-1.5 overflow-hidden whitespace-nowrap"
                        >
                          <TimelineCardPropertyLabels
                            databaseId={databaseId}
                            pageId={row.page.id}
                            excludeColumnIds={activeDateColumnIdList}
                            fallbackDbCells={row.page.dbCells}
                            className="font-normal"
                            style={{ color: labelTextColor }}
                          />
                        </TimelineCardText>
                      </div>
                    </Rnd>
                  );
                })}
                {row.cards.length === 0 && primaryDateCol && (
                  // 날짜 미등록 항목 — 항목 컬럼 우측에 흰색 카드로 고정, 드래그하면 날짜가 정해진다.
                  // (일반 데이터베이스 타임라인의 "날짜 없음" 카드와 동일 동작)
                  <Rnd
                    dragAxis="x"
                    enableResizing={false}
                    bounds="parent"
                    position={{ x: trackScrollLeft + CARD_MARGIN, y: cardTop }}
                    size={{ width: 168, height: cardHeight }}
                    onDragStop={(_event, data) => {
                      void commitUnscheduledDate(row.page.id, data.x);
                    }}
                    className="z-[2]"
                  >
                    <button
                      type="button"
                      onDoubleClick={() => {
                        void openTimelineRowPeek(row.page.id);
                      }}
                      onTouchStart={(event) => cardDoubleTap.onTouchStart(row.page.id, event)}
                      onTouchEnd={(event) => cardDoubleTap.onTouchEnd(row.page.id, event)}
                      onTouchCancel={cardDoubleTap.onTouchCancel}
                      title="드래그하여 날짜를 지정하세요"
                      className="flex h-full w-full cursor-grab items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-md border border-dashed border-zinc-300 bg-white px-2 text-left text-xs font-semibold text-zinc-700 shadow-sm active:cursor-grabbing dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200"
                    >
                      <span className="shrink-0">{row.page.title || "제목 없음"}</span>
                      <span className="shrink-0 font-normal text-zinc-400 dark:text-zinc-500">
                        날짜 없음
                      </span>
                      <TimelineCardPropertyLabels
                        databaseId={databaseId}
                        pageId={row.page.id}
                        excludeColumnIds={activeDateColumnIdList}
                        fallbackDbCells={row.page.dbCells}
                        className="font-normal text-zinc-500 dark:text-zinc-400"
                      />
                    </button>
                  </Rnd>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
    {hoveredCard &&
      createPortal(
        <div
          className="pointer-events-none fixed z-[600] max-w-[260px] rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          style={{
            top: hoveredCard.top,
            left: hoveredCard.left,
            transform: hoveredCard.placeAbove ? "translateY(-100%)" : undefined,
          }}
        >
          <div className="mb-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
            {hoveredCard.columnName} · {hoveredCard.dateLabel}
          </div>
          <div className="font-semibold text-zinc-900 dark:text-zinc-100">
            {hoveredCard.title || "제목 없음"}
          </div>
          <ScheduleCardDetailRows
            databaseId={databaseId}
            pageId={hoveredCard.pageId}
            excludeColumnIds={activeDateColumnIdList}
            fallbackDbCells={schedulerPages[hoveredCard.pageId]?.dbCells}
          />
        </div>,
        document.body,
      )}
    {cardColorMenu &&
      createPortal(
        <ContextMenu
          x={cardColorMenu.left}
          y={cardColorMenu.top}
          currentColor={cardColorMenu.currentColor}
          onColorChange={(color) => {
            void handleTimelineCardColorChange(color);
          }}
          onClose={() => setCardColorMenu(null)}
        />,
        document.body,
      )}
    </>
  );
}
