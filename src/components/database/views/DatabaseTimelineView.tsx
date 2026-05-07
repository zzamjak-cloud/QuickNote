/* eslint-disable react-hooks/purity -- 축/오늘 기준선은 렌더 시각의 Date.now() 사용 */
/* eslint-disable react-hooks/preserve-manual-memoization -- React Compiler와 기존 useMemo 병행 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, PanelRight, Plus, X, ZoomIn, ZoomOut } from "lucide-react";
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
import { usePageStore } from "../../../store/pageStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { useUiStore } from "../../../store/uiStore";
import { SimpleConfirmDialog } from "../../ui/SimpleConfirmDialog";
import {
  DAY_MS,
  TIMELINE_WEEK_CAL_DAYS as WEEK_CAL_DAYS,
  TIMELINE_WEEK_RANGE_DAYS as WEEK_RANGE_DAYS,
  timelineClampToWeekday as clampToWeekday,
  timelineGetRange as getRange,
  timelineHexToRgba as hexToRgba,
  timelinePickStatusColor as pickStatusColor,
  timelineStartOfDay as startOfDay,
  timelineStartOfWeekMon as startOfWeekMon,
  timelineWeekLabel as weekLabel,
  timelineWeekdayIndex as weekdayIndex,
} from "../../../lib/database/timelineGeometry";

type Props = {
  databaseId: string;
  panelState: DatabasePanelState;
  setPanelState: (p: Partial<DatabasePanelState>) => void;
};

type Granularity = "day" | "week";

const ROW_HEIGHT = 32;
const ROW_GAP = 4;
const HEADER_HEIGHT = 36;
const SIDE_LABEL_W = 160;
const CELL_WIDTH_MIN = 12;
const CELL_WIDTH_MAX = 120;
const CELL_WIDTH_STEP = 8;
const CELL_WIDTH_DEFAULT = 36;

const fmtDate = (ts: number) => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

export function DatabaseTimelineView({
  databaseId,
  panelState,
  setPanelState,
}: Props) {
  const { bundle, rows, columns } = useProcessedRows(databaseId, panelState);
  const addRow = useDatabaseStore((s) => s.addRow);
  const deleteRow = useDatabaseStore((s) => s.deleteRow);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const openPeek = useUiStore((s) => s.openPeek);

  const [granularity, setGranularity] = useState<Granularity>("day");
  const [cellWidthOverride, setCellWidthOverride] = useState(CELL_WIDTH_DEFAULT);
  const trackRef = useRef<HTMLDivElement | null>(null);
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

  const [rowDeletePageId, setRowDeletePageId] = useState<string | null>(null);

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

  const axis = useMemo(() => {
    if (granularity === "week") {
      const thisWeekStart = startOfWeekMon(Date.now());
      const minT = thisWeekStart - WEEK_CAL_DAYS * DAY_MS;
      const maxT = minT + (2 * WEEK_CAL_DAYS + 4) * DAY_MS;
      const totalDays = WEEK_RANGE_DAYS;
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
    const cellWidth = cellWidthOverride;
    const totalW = totalDays * cellWidth;
    return { minT, maxT, totalDays, cellWidth, totalW };
  }, [dateRanges, granularity, cellWidthOverride]);

  if (!bundle) return null;

  const pxPerDay =
    granularity === "week"
      ? trackPxWidth / WEEK_RANGE_DAYS
      : axis.cellWidth;

  const dayToX = (t: number): number => {
    if (granularity === "week") {
      const idx = weekdayIndex(t, axis.minT);
      if (idx < 0) return 0;
      return Math.round(idx * pxPerDay);
    }
    return Math.round(((t - axis.minT) / DAY_MS) * pxPerDay);
  };

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
  }

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
        {/* 일 모드 전용 셀 너비 줌 컨트롤 */}
        {granularity === "day" && (
          <div className="ml-1 inline-flex items-center gap-1 rounded border border-zinc-300 px-1 dark:border-zinc-600">
            <button
              type="button"
              onClick={() => setCellWidthOverride((w) => Math.max(CELL_WIDTH_MIN, w - CELL_WIDTH_STEP))}
              disabled={cellWidthOverride <= CELL_WIDTH_MIN}
              title="축소"
              className="rounded p-0.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
            >
              <ZoomOut size={13} />
            </button>
            <span className="min-w-[2rem] text-center text-[11px] text-zinc-500">{cellWidthOverride}px</span>
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
      </div>

      {!dateColId ? (
        <p className="py-6 text-center text-xs text-zinc-500">
          날짜 타입 속성을 추가한 뒤 타임라인 축으로 지정하세요.
        </p>
      ) : (
        <div
          className={[
            "rounded border border-zinc-200 dark:border-zinc-700",
            granularity === "day" ? "overflow-x-auto" : "overflow-hidden",
          ].join(" ")}
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
            {/* 헤더 */}
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
                    className="group relative flex items-center gap-1 truncate border-b border-zinc-100 px-2 dark:border-zinc-800"
                    style={{ height: ROW_HEIGHT + ROW_GAP }}
                  >
                    <span className="truncate pr-14 text-xs text-zinc-700 dark:text-zinc-200">
                      {row.title || "제목 없음"}
                    </span>
                    <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded bg-white/90 opacity-0 backdrop-blur-sm group-hover:opacity-100 dark:bg-zinc-950/90">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openFull(row.pageId);
                        }}
                        title="페이지로 열기"
                        className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                      >
                        <ArrowUpRight size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openPeek(row.pageId);
                        }}
                        title="사이드 피크 열기"
                        className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                      >
                        <PanelRight size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRowDeletePageId(row.pageId);
                        }}
                        title="행 삭제"
                        className="rounded p-0.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                      >
                        <X size={12} />
                      </button>
                    </div>
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
                {todayX >= 0 && todayX <= (granularity === "day" ? axis.totalW : trackPxWidth) && (
                  <div
                    className="absolute top-0 z-[1] w-px bg-red-400/80"
                    style={{ left: todayX, height: rows.length * (ROW_HEIGHT + ROW_GAP) }}
                  />
                )}

                {/* 행별 트랙 배경 */}
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

                {/* 주 모드: pxPerDay 측정 전엔 미렌더 */}
                {(granularity === "day" || (Number.isFinite(pxPerDay) && pxPerDay > 0)) && rows.map((row, rIdx) => {
                  const range = getRange(row.cells[dateColId]);
                  if (!range) return null;
                  let visStart = Math.max(range.start, axis.minT);
                  let visEnd = Math.min(range.end, axis.maxT);
                  if (visEnd < axis.minT || visStart > axis.maxT) return null;
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
                  const dateLabel = `${fmtDate(range.start)} ~ ${fmtDate(range.end)}`;
                  const tooltipText = `${row.title || "제목 없음"} (${dateLabel})`;
                  return (
                    <div
                      key={row.pageId}
                      className="group absolute cursor-pointer rounded-md border bg-white shadow-sm transition-shadow hover:shadow-md dark:bg-zinc-900"
                      style={{
                        left,
                        top,
                        width: Math.max(w, 24),
                        height: ROW_HEIGHT - 4,
                        borderColor: color ?? "#60a5fa",
                        background: hexToRgba(color, 0.18),
                      }}
                      title={tooltipText}
                      onClick={() => openFull(row.pageId)}
                    >
                      {/* 텍스트 — 항상 표시, 호버 버튼에 가려지지 않도록 오른쪽 여백 확보 */}
                      <div className="flex h-full min-w-0 items-center gap-1.5 overflow-hidden px-2 pr-16 text-[11px]">
                        <span
                          className="inline-block h-2 w-2 shrink-0 rounded-full"
                          style={{ background: color ?? "#60a5fa" }}
                        />
                        <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                          {row.title || "제목 없음"}
                        </span>
                        <span className="shrink-0 text-[10px] text-zinc-500 dark:text-zinc-400">
                          {dateLabel}
                        </span>
                        {labelCols.length > 0 && (
                          <span className="ml-0.5 truncate text-[10px] text-zinc-400 dark:text-zinc-500">
                            {labelCols
                              .map((c) => formatLabelValue(row.cells[c.id], c))
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        )}
                      </div>
                      {/* 호버 버튼 — 절대 위치로 텍스트 레이아웃에 영향 없음 */}
                      <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded bg-white/90 opacity-0 backdrop-blur-sm group-hover:opacity-100 dark:bg-zinc-900/90">
                        <button
                          type="button"
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
                          onClick={(e) => {
                            e.stopPropagation();
                            openPeek(row.pageId);
                          }}
                          title="사이드 피크 열기"
                          className="rounded p-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800"
                        >
                          <PanelRight size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRowDeletePageId(row.pageId);
                          }}
                          title="항목 삭제"
                          className="rounded p-0.5 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                        >
                          <X size={11} />
                        </button>
                      </div>
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
      <SimpleConfirmDialog
        open={rowDeletePageId !== null}
        title="행 삭제"
        message="이 행을 삭제할까요? (연결된 페이지도 삭제됩니다)"
        confirmLabel="삭제"
        danger
        onCancel={() => setRowDeletePageId(null)}
        onConfirm={() => {
          if (rowDeletePageId) deleteRow(databaseId, rowDeletePageId);
          setRowDeletePageId(null);
        }}
      />
    </div>
  );
}

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
