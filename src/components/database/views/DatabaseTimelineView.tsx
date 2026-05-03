import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, PanelRight, Plus } from "lucide-react";
import type {
  CellValue,
  ColumnDef,
  DatabasePanelState,
  DatabaseRowView,
  DateRangeValue,
} from "../../../types/database";
import { getVisibleOrderedColumns } from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useProcessedRows } from "../useProcessedRows";
import { DatabaseColumnSettingsButton } from "../DatabaseColumnSettingsButton";
import { usePageStore } from "../../../store/pageStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { useUiStore } from "../../../store/uiStore";

type Props = {
  databaseId: string;
  panelState: DatabasePanelState;
  setPanelState: (p: Partial<DatabasePanelState>) => void;
};

type Granularity = "day" | "week";

const DAY_MS = 24 * 60 * 60 * 1000;
const ROW_HEIGHT = 32;
const ROW_GAP = 4;
const HEADER_HEIGHT = 36;
const SIDE_LABEL_W = 160;
// 주 모드: 평일(월~금) 5일 × 3주 = 15 weekdays. 토/일은 시각화 제외.
const WEEK_DAYS = 5;
const WEEK_RANGE_DAYS = WEEK_DAYS * 3;
/** 캘린더상의 주 1개(7일) 길이. 주 시작점 계산용. */
const WEEK_CAL_DAYS = 7;

/** YYYY-MM-DD 추출. */
function isoDate(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 월요일 시작 기준 주의 시작일(00:00) 반환. */
function startOfWeekMon(t: number): number {
  const d = new Date(startOfDay(t));
  // getDay(): 일=0, 월=1, ..., 토=6 → 월요일까지 거슬러갈 일수.
  const dow = d.getDay();
  const back = (dow + 6) % 7; // 월=0, 일=6
  d.setDate(d.getDate() - back);
  return d.getTime();
}

function getRange(cell: CellValue): { start: number; end: number } | null {
  if (!cell || typeof cell !== "object" || Array.isArray(cell)) return null;
  if (!("start" in cell)) return null;
  const v = cell as DateRangeValue;
  const s = v.start ? Date.parse(v.start) : NaN;
  if (!Number.isFinite(s)) return null;
  const start = startOfDay(s);
  const e = v.end ? Date.parse(v.end) : NaN;
  const end = Number.isFinite(e) ? startOfDay(e) : start;
  return { start, end: Math.max(end, start) };
}

/** 16진 컬러 → rgba (카드 배경용). */
function hexToRgba(hex: string | undefined, alpha: number): string {
  if (!hex) return `rgba(96, 165, 250, ${alpha})`;
  const m = /^#?([\da-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** status/select 첫 옵션 컬러 (없으면 undefined). */
function pickStatusColor(
  row: DatabaseRowView,
  columns: ColumnDef[],
): string | undefined {
  const col =
    columns.find((c) => c.type === "status") ??
    columns.find((c) => c.type === "select");
  if (!col) return undefined;
  const raw = row.cells[col.id];
  if (typeof raw !== "string") return undefined;
  return col.config?.options?.find((o) => o.id === raw)?.color;
}

/** 주 헤더 라벨 포맷: 평일 첫(월) ~ 마지막(금) — "MM/DD - MM/DD". */
function weekLabel(start: number): string {
  const s = new Date(start);
  // 평일 마지막 = 시작(월) + 4일 = 금요일.
  const e = new Date(start + 4 * DAY_MS);
  return `${s.getMonth() + 1}/${s.getDate()} - ${e.getMonth() + 1}/${e.getDate()}`;
}

/**
 * 주 모드 평일 인덱스(0~14): minT가 지난주 월요일일 때, t가 어느 평일인지 반환.
 * 주말(토/일)이면 -1.
 */
function weekdayIndex(t: number, minT: number): number {
  const day = startOfDay(t);
  const dow = new Date(day).getDay(); // 일=0..토=6
  if (dow === 0 || dow === 6) return -1;
  const diffDays = Math.round((day - minT) / DAY_MS);
  if (diffDays < 0 || diffDays >= WEEK_CAL_DAYS * 3) return -1;
  const weekIdx = Math.floor(diffDays / WEEK_CAL_DAYS); // 0,1,2
  const weekdayInWeek = (dow + 6) % 7; // 월=0..금=4 (토=5,일=6은 위에서 제외)
  if (weekdayInWeek > 4) return -1;
  return weekIdx * WEEK_DAYS + weekdayInWeek;
}

/**
 * 주 모드용: 시작/종료를 가장 가까운 평일로 클램프.
 * - start: 주말이면 다음 평일(월)로,
 * - end:   주말이면 이전 평일(금)로.
 * 반환: 평일 단위 시작/종료 timestamp(00:00). 둘 사이가 역전되면 null.
 */
function clampToWeekday(
  start: number,
  end: number,
): { start: number; end: number } | null {
  const ns = nextWeekday(start);
  const ne = prevWeekday(end);
  if (ns > ne) return null;
  return { start: ns, end: ne };
}

function nextWeekday(t: number): number {
  let d = startOfDay(t);
  for (let i = 0; i < 7; i++) {
    const dow = new Date(d).getDay();
    if (dow !== 0 && dow !== 6) return d;
    d += DAY_MS;
  }
  return d;
}

function prevWeekday(t: number): number {
  let d = startOfDay(t);
  for (let i = 0; i < 7; i++) {
    const dow = new Date(d).getDay();
    if (dow !== 0 && dow !== 6) return d;
    d -= DAY_MS;
  }
  return d;
}

export function DatabaseTimelineView({
  databaseId,
  panelState,
  setPanelState,
}: Props) {
  const { bundle, rows, columns } = useProcessedRows(databaseId, panelState);
  const addRow = useDatabaseStore((s) => s.addRow);
  const updateCell = useDatabaseStore((s) => s.updateCell);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const openPeek = useUiStore((s) => s.openPeek);

  const [granularity, setGranularity] = useState<Granularity>("day");
  // 주 모드에서 트랙 너비를 측정하기 위한 ref(컨테이너 너비 비례 변환에 사용).
  const trackRef = useRef<HTMLDivElement | null>(null);
  // ResizeObserver로 트랙 폭을 state로 보관 — 첫 렌더/리사이즈에도 정확한 px 변환.
  const [trackPxWidth, setTrackPxWidth] = useState(0);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setTrackPxWidth(el.clientWidth);
    });
    ro.observe(el);
    setTrackPxWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [granularity]);
  const dragRef = useRef<{
    pageId: string;
    columnId: string;
    mode: "move" | "resize-start" | "resize-end";
    origStart: number;
    origEnd: number;
    originX: number;
    /** 1일에 해당하는 픽셀 폭 (드래그 시작 시점). */
    pxPerDay: number;
  } | null>(null);
  const [dragTick, setDragTick] = useState(0); // 드래그 중 강제 리렌더용

  const dateCols = columns.filter((c) => c.type === "date");
  const dateColId =
    panelState.timelineDateColumnId ?? dateCols[0]?.id ?? null;

  // 보조 라벨로 사용할 컬럼 — viewConfigs.timeline > 기본은 title 외 첫 1개.
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

  // 모든 행의 날짜 범위를 모아 시간축 범위 결정.
  const dateRanges = useMemo(() => {
    if (!dateColId) return [] as { row: DatabaseRowView; start: number; end: number }[];
    const out: { row: DatabaseRowView; start: number; end: number }[] = [];
    for (const r of rows) {
      const range = getRange(r.cells[dateColId]);
      if (range) out.push({ row: r, ...range });
    }
    return out;
    // dragTick으로 드래그 중에도 갱신.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, dateColId, dragTick]);

  // 시간축:
  // - 일 모드: [최소 시작 - 7일, 최대 종료 + 7일] 또는 비어있으면 오늘 ± 14일.
  // - 주 모드: 오늘이 속한 주의 월요일 기준 -1주 ~ +1주(끝일) → 21일 고정.
  const axis = useMemo(() => {
    if (granularity === "week") {
      const thisWeekStart = startOfWeekMon(Date.now());
      const minT = thisWeekStart - WEEK_CAL_DAYS * DAY_MS; // 지난주 월요일
      // 다음주 금요일까지 평일만 시각화. 캘린더상 마지막 weekday: minT + 2주(14일) + 4일(금).
      const maxT = minT + (2 * WEEK_CAL_DAYS + 4) * DAY_MS;
      const totalDays = WEEK_RANGE_DAYS;
      // 주 모드는 컨테이너 너비를 비율로 분할 — cellWidth/totalW는 렌더 시점에 측정.
      return { minT, maxT, totalDays, cellWidth: 0, totalW: 0 };
    }
    let minT: number;
    let maxT: number;
    if (dateRanges.length === 0) {
      const today = startOfDay(Date.now());
      minT = today - 14 * DAY_MS;
      maxT = today + 14 * DAY_MS;
    } else {
      minT = Math.min(...dateRanges.map((r) => r.start)) - 7 * DAY_MS;
      maxT = Math.max(...dateRanges.map((r) => r.end)) + 7 * DAY_MS;
    }
    const totalDays = Math.max(1, Math.round((maxT - minT) / DAY_MS) + 1);
    const cellWidth = 36;
    const totalW = totalDays * cellWidth;
    return { minT, maxT, totalDays, cellWidth, totalW };
  }, [dateRanges, granularity]);

  if (!bundle) return null;

  // 주 모드: 측정된 트랙 너비로 1일(평일 1칸)당 픽셀을 산출.
  // 일 모드: 셀 폭 고정. 주 모드 측정 전(0)이면 카드 미렌더로 깜빡임 방지.
  const pxPerDay =
    granularity === "week"
      ? trackPxWidth / WEEK_RANGE_DAYS
      : axis.cellWidth;

  /**
   * 평일 인덱스 기준 X 좌표.
   * - 주 모드: weekdayIndex(0~14)*pxPerDay.
   * - 일 모드: 캘린더일수 기준.
   */
  const dayToX = (t: number): number => {
    if (granularity === "week") {
      const idx = weekdayIndex(t, axis.minT);
      if (idx < 0) return 0;
      return Math.round(idx * pxPerDay);
    }
    return Math.round(((t - axis.minT) / DAY_MS) * pxPerDay);
  };
  /** 시작/종료 평일 인덱스 차이로 카드 폭 계산. */
  const dayWidth = (start: number, end: number): number => {
    if (granularity === "week") {
      const sIdx = weekdayIndex(start, axis.minT);
      const eIdx = weekdayIndex(end, axis.minT);
      if (sIdx < 0 || eIdx < 0) return pxPerDay;
      const days = eIdx - sIdx + 1;
      return Math.max(pxPerDay, days * pxPerDay);
    }
    const days = Math.round((end - start) / DAY_MS) + 1;
    return Math.max(pxPerDay, days * pxPerDay);
  };

  const openFull = (pageId: string) => {
    setActivePage(pageId);
    setCurrentTabPage(pageId);
  };

  const handlePointerDown = (
    e: React.PointerEvent,
    row: DatabaseRowView,
    range: { start: number; end: number },
    mode: "move" | "resize-start" | "resize-end",
  ) => {
    if (!dateColId) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      pageId: row.pageId,
      columnId: dateColId,
      mode,
      origStart: range.start,
      origEnd: range.end,
      originX: e.clientX,
      pxPerDay,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.originX;
    const dDays = d.pxPerDay > 0 ? Math.round(dx / d.pxPerDay) : 0;
    let newStart = d.origStart;
    let newEnd = d.origEnd;
    if (d.mode === "move") {
      newStart = d.origStart + dDays * DAY_MS;
      newEnd = d.origEnd + dDays * DAY_MS;
    } else if (d.mode === "resize-start") {
      newStart = Math.min(d.origStart + dDays * DAY_MS, d.origEnd);
    } else {
      newEnd = Math.max(d.origEnd + dDays * DAY_MS, d.origStart);
    }
    const nextValue: DateRangeValue = {
      start: isoDate(newStart),
      end: isoDate(newEnd),
    };
    updateCell(databaseId, d.pageId, d.columnId, nextValue);
    // 드래그 중에도 카드 위치를 갱신하기 위해 의존 useMemo 키를 흔든다.
    setDragTick((t) => t + 1);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragRef.current) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch { /* noop */ }
      dragRef.current = null;
    }
  };

  // 헤더 라벨/그리드 라인 — 모드별로 다르게 구성.
  type HeaderTick = { x: number; label: string; major?: boolean; widthPct?: number };
  const headerTicks: HeaderTick[] = [];
  if (granularity === "day") {
    for (let i = 0; i < axis.totalDays; i++) {
      const t = axis.minT + i * DAY_MS;
      const d = new Date(t);
      headerTicks.push({
        x: i * axis.cellWidth,
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        major: d.getDate() === 1,
      });
    }
  } else {
    // 주 모드: 3개 컬럼(지난주/이번주/다음주) — 헤더는 % 폭으로 배치.
    // 각 주의 시작은 캘린더 월요일(7일 간격), 라벨은 평일(월~금)로 표기.
    const labels = ["지난 주", "이번 주", "다음 주"];
    for (let i = 0; i < 3; i++) {
      const wkStart = axis.minT + i * WEEK_CAL_DAYS * DAY_MS;
      headerTicks.push({
        x: 0, // % 기반이라 무시
        label: `${labels[i]} (${weekLabel(wkStart)})`,
        major: i === 1,
        widthPct: 100 / 3,
      });
    }
  }

  // 오늘 마커 X — 주 모드에서 오늘이 주말이면 -1로 두어 미표시.
  const todayX =
    granularity === "week"
      ? (() => {
          const idx = weekdayIndex(Date.now(), axis.minT);
          if (idx < 0 || !Number.isFinite(pxPerDay) || pxPerDay <= 0) return -1;
          return Math.round(idx * pxPerDay);
        })()
      : dayToX(startOfDay(Date.now()));

  return (
    <div className="select-none">
      {/* 컨트롤 바 */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-zinc-600 dark:text-zinc-400">날짜 속성</span>
        <select
          value={dateColId ?? ""}
          onChange={(e) =>
            setPanelState({
              timelineDateColumnId: e.target.value || null,
            })
          }
          className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900"
        >
          <option value="">선택…</option>
          {dateCols.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="ml-2 inline-flex overflow-hidden rounded border border-zinc-300 dark:border-zinc-600">
          {(["day", "week"] as Granularity[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGranularity(g)}
              className={[
                "px-2 py-1 text-[11px]",
                granularity === g
                  ? "bg-blue-500 text-white"
                  : "bg-white text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
              ].join(" ")}
            >
              {g === "day" ? "일" : "주"}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <DatabaseColumnSettingsButton
            databaseId={databaseId}
            viewKind="timeline"
            panelState={panelState}
            setPanelState={setPanelState}
          />
        </div>
      </div>

      {!dateColId ? (
        <p className="py-6 text-center text-xs text-zinc-500">
          날짜 타입 속성을 추가한 뒤 타임라인 축으로 지정하세요.
        </p>
      ) : (
        <div
          className={[
            "rounded border border-zinc-200 dark:border-zinc-700",
            // 주 모드는 컨테이너 너비에 맞춰 3등분 → 가로 스크롤 불필요.
            granularity === "day" ? "overflow-x-auto" : "overflow-hidden",
          ].join(" ")}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div
            className="relative"
            style={{
              width:
                granularity === "day"
                  ? SIDE_LABEL_W + axis.totalW
                  : "100%",
              minHeight:
                HEADER_HEIGHT + (rows.length || 1) * (ROW_HEIGHT + ROW_GAP) + 16,
            }}
          >
            {/* 헤더 (좌측 라벨 영역 + 날짜 축) */}
            <div
              className="sticky top-0 z-10 flex border-b border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950"
              style={{ height: HEADER_HEIGHT }}
            >
              <div
                className="shrink-0 border-r border-zinc-200 px-2 py-2 text-[10px] uppercase text-zinc-400 dark:border-zinc-700"
                style={{ width: SIDE_LABEL_W }}
              >
                항목
              </div>
              {granularity === "day" ? (
                <div className="relative" style={{ width: axis.totalW }}>
                  {headerTicks.map((t, i) => (
                    <div
                      key={i}
                      className={[
                        "absolute top-0 h-full text-[10px]",
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
              ) : (
                // 주 모드: flex-1로 3등분.
                <div className="relative flex flex-1">
                  {headerTicks.map((t, i) => (
                    <div
                      key={i}
                      className={[
                        "flex flex-1 items-center justify-center border-l text-[11px] truncate px-2",
                        t.major
                          ? "border-zinc-300 font-semibold text-zinc-800 dark:border-zinc-600 dark:text-zinc-100"
                          : "border-zinc-100 text-zinc-500 dark:border-zinc-800",
                      ].join(" ")}
                    >
                      {t.label}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 본문 */}
            <div className="flex">
              {/* 좌측 라벨 컬럼 */}
              <div
                className="shrink-0 border-r border-zinc-200 dark:border-zinc-700"
                style={{ width: SIDE_LABEL_W }}
              >
                {rows.map((row) => (
                  <div
                    key={row.pageId}
                    className="flex items-center gap-1 truncate border-b border-zinc-100 px-2 dark:border-zinc-800"
                    style={{ height: ROW_HEIGHT + ROW_GAP }}
                  >
                    <span className="truncate text-xs text-zinc-700 dark:text-zinc-200">
                      {row.title || "제목 없음"}
                    </span>
                  </div>
                ))}
              </div>

              {/* 우측 트랙 + 카드 */}
              <div
                ref={trackRef}
                className="relative flex-1"
                style={
                  granularity === "day"
                    ? { width: axis.totalW }
                    : undefined
                }
              >
                {/* 세로 그리드 라인 */}
                {granularity === "day"
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
                  : // 주 모드는 % 기준 라인 3개(좌측 경계).
                    [0, 1, 2].map((i) => (
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

                {/* 오늘 마커 — 주 모드에서는 항상 범위 내. */}
                {todayX >= 0 && todayX <= (granularity === "day" ? axis.totalW : trackPxWidth) && (
                  <div
                    className="absolute top-0 z-[1] w-px bg-red-400/80"
                    style={{ left: todayX, height: rows.length * (ROW_HEIGHT + ROW_GAP) }}
                  />
                )}

                {/* 행별 트랙 배경 (가로줄) */}
                {rows.map((row, rIdx) => (
                  <div
                    key={`track:${row.pageId}`}
                    className="absolute left-0 right-0 border-b border-zinc-100 dark:border-zinc-800"
                    style={{
                      top: rIdx * (ROW_HEIGHT + ROW_GAP),
                      height: ROW_HEIGHT + ROW_GAP,
                    }}
                  />
                ))}
                {/* 주 모드: pxPerDay가 0/NaN이면(첫 측정 전) 카드를 그리지 않음 — 깜빡임 방지. */}
                {(granularity === "day" || (Number.isFinite(pxPerDay) && pxPerDay > 0)) && rows.map((row, rIdx) => {
                  const range = getRange(row.cells[dateColId]);
                  if (!range) return null;
                  // 3주 범위 밖이면 클리핑.
                  let visStart = Math.max(range.start, axis.minT);
                  let visEnd = Math.min(range.end, axis.maxT);
                  if (visEnd < axis.minT || visStart > axis.maxT) return null;
                  // 주 모드: 시작/종료를 평일로 클램프 — 주말에 걸린 부분은 잘라냄.
                  if (granularity === "week") {
                    const c = clampToWeekday(visStart, visEnd);
                    if (!c) return null;
                    visStart = c.start;
                    visEnd = c.end;
                  }
                  const left = dayToX(visStart);
                  const w = dayWidth(visStart, visEnd);
                  const color = pickStatusColor(row, columns);
                  const top = rIdx * (ROW_HEIGHT + ROW_GAP) + 2;
                  // 트림 여부 — 트림된 쪽은 리사이즈 핸들 비활성.
                  const trimLeft = range.start < axis.minT;
                  const trimRight = range.end > axis.maxT;
                  return (
                    <div
                      key={row.pageId}
                      className="group absolute flex items-center rounded-md border bg-white shadow-sm transition-shadow hover:shadow-md dark:bg-zinc-900"
                      style={{
                        left,
                        top,
                        width: Math.max(w, 24),
                        height: ROW_HEIGHT - 4,
                        borderColor: color ?? "#60a5fa",
                        background: hexToRgba(color, 0.18),
                      }}
                      onPointerDown={(e) =>
                        handlePointerDown(e, row, range, "move")
                      }
                    >
                      {/* 좌 리사이즈 핸들 */}
                      {!trimLeft && (
                        <span
                          onPointerDown={(e) =>
                            handlePointerDown(e, row, range, "resize-start")
                          }
                          className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize rounded-l-md bg-transparent group-hover:bg-blue-400/40"
                        />
                      )}
                      <div className="flex min-w-0 flex-1 items-center gap-2 px-2 text-[11px]">
                        <span
                          className="inline-block h-2 w-2 shrink-0 rounded-full"
                          style={{ background: color ?? "#60a5fa" }}
                        />
                        <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                          {row.title || "제목 없음"}
                        </span>
                        {labelCols.length > 0 && (
                          <span className="ml-1 truncate text-[10px] text-zinc-500 dark:text-zinc-400">
                            {labelCols
                              .map((c) => formatLabelValue(row.cells[c.id], c))
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5 pr-1 opacity-0 group-hover:opacity-100">
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            openFull(row.pageId);
                          }}
                          title="페이지로 열기"
                          className="rounded p-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800"
                        >
                          <ArrowUpRight size={11} />
                        </button>
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            openPeek(row.pageId);
                          }}
                          title="사이드 피크 열기"
                          className="rounded p-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800"
                        >
                          <PanelRight size={11} />
                        </button>
                      </div>
                      {/* 우 리사이즈 핸들 */}
                      {!trimRight && (
                        <span
                          onPointerDown={(e) =>
                            handlePointerDown(e, row, range, "resize-end")
                          }
                          className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r-md bg-transparent group-hover:bg-blue-400/40"
                        />
                      )}
                    </div>
                  );
                })}
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
    </div>
  );
}

/** 보조 라벨을 위한 간단 포매터. */
function formatLabelValue(v: CellValue, col: ColumnDef): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") {
    if (col.type === "status" || col.type === "select") {
      return col.config?.options?.find((o) => o.id === v)?.label ?? v;
    }
    return v;
  }
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "예" : "아니오";
  if (Array.isArray(v)) {
    if (v.length > 0 && typeof v[0] === "object" && v[0] && "fileId" in v[0]) {
      return `${v.length}개 파일`;
    }
    const ids = v as string[];
    const opts = col.config?.options ?? [];
    return ids
      .map((id) => opts.find((o) => o.id === id)?.label ?? id)
      .join(", ");
  }
  if (typeof v === "object" && "start" in (v as object)) {
    const d = v as DateRangeValue;
    return [d.start, d.end].filter(Boolean).join(" ~ ");
  }
  return "";
}
