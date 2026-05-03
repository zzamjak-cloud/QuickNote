import { useMemo, useRef, useState } from "react";
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

/** YYYY-MM-DD 추출. */
function isoDate(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
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
  const dragRef = useRef<{
    pageId: string;
    columnId: string;
    mode: "move" | "resize-start" | "resize-end";
    origStart: number;
    origEnd: number;
    originX: number;
    cellWidth: number;
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
  }, [rows, dateColId, dragTick]);

  // 시간축: [최소 시작 - 7일, 최대 종료 + 7일] 또는 비어있으면 오늘 ± 14일.
  const axis = useMemo(() => {
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
    const cellWidth = granularity === "day" ? 36 : 18;
    const totalW = totalDays * cellWidth;
    return { minT, maxT, totalDays, cellWidth, totalW };
  }, [dateRanges, granularity]);

  if (!bundle) return null;

  const dayToX = (t: number): number => {
    return Math.round(((t - axis.minT) / DAY_MS) * axis.cellWidth);
  };
  const dayWidth = (start: number, end: number): number => {
    const days = Math.round((end - start) / DAY_MS) + 1;
    return Math.max(axis.cellWidth, days * axis.cellWidth);
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
      cellWidth: axis.cellWidth,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.originX;
    const dDays = Math.round(dx / d.cellWidth);
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

  // 헤더 라벨: 일 단위는 매일, 주 단위는 7일마다.
  const headerTicks: { x: number; label: string; major?: boolean }[] = [];
  for (let i = 0; i < axis.totalDays; i++) {
    const t = axis.minT + i * DAY_MS;
    const d = new Date(t);
    if (granularity === "day") {
      headerTicks.push({
        x: i * axis.cellWidth,
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        major: d.getDate() === 1,
      });
    } else if (i % 7 === 0) {
      headerTicks.push({
        x: i * axis.cellWidth,
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        major: d.getDate() <= 7,
      });
    }
  }

  const todayX = dayToX(startOfDay(Date.now()));

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
          className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-700"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div
            className="relative"
            style={{
              width: SIDE_LABEL_W + axis.totalW,
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
              <div className="relative" style={{ width: axis.totalW }}>
                {/* 세로 그리드 라인 */}
                {headerTicks.map((t, i) => (
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
                ))}

                {/* 오늘 마커 */}
                {todayX >= 0 && todayX <= axis.totalW && (
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
                {rows.map((row, rIdx) => {
                  const range = getRange(row.cells[dateColId]);
                  if (!range) return null;
                  const left = dayToX(range.start);
                  const w = dayWidth(range.start, range.end);
                  const color = pickStatusColor(row, columns);
                  const top = rIdx * (ROW_HEIGHT + ROW_GAP) + 2;
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
                      <span
                        onPointerDown={(e) =>
                          handlePointerDown(e, row, range, "resize-start")
                        }
                        className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize rounded-l-md bg-transparent group-hover:bg-blue-400/40"
                      />
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
                      <span
                        onPointerDown={(e) =>
                          handlePointerDown(e, row, range, "resize-end")
                        }
                        className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r-md bg-transparent group-hover:bg-blue-400/40"
                      />
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
