import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Check,
  Minus,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import type { DatabasePanelState, ColumnDef, DatabaseRowView, CellValue } from "../../../types/database";
import { defaultMinWidthForType, getVisibleOrderedColumns } from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useProcessedRows } from "../useProcessedRows";
import { DatabaseCell } from "../DatabaseCell";
import { DatabaseColumnHeader } from "../DatabaseColumnHeader";
import { DatabaseAddColumnButton } from "../DatabaseAddColumnButton";
import { usePageStore } from "../../../store/pageStore";
import { IconPicker } from "../../common/IconPicker";
import { useUiStore } from "../../../store/uiStore";
import { SimpleConfirmDialog } from "../../ui/SimpleConfirmDialog";
import { useTableRowSelection } from "./useTableRowSelection";
import { useHistoryStore } from "../../../store/historyStore";
import { useWindowedRows } from "./useWindowedRows";
import { cellToSearchString } from "../../../lib/databaseQuery";

type Props = {
  databaseId: string;
  panelState: DatabasePanelState;
  setPanelState: (p: Partial<DatabasePanelState>) => void;
  /** 표시할 최대 행 수. 미지정 시 전체 표시. */
  visibleRowLimit?: number;
  layout?: "inline" | "fullPage";
};

function cloneCellValue<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

type FillDragState = { columnId: string; sourceRowIndex: number; sourceValue: CellValue };

// props 얕은 비교: row/isBoxSelected 변경 시만 리렌더. 셀 편집 시 다른 행은 리렌더하지 않음.
const DatabaseTableRow = memo(function DatabaseTableRow({
  row,
  rIdx,
  databaseId,
  visibleCols,
  isBoxSelected,
  fillDrag,
  fillHoverRowIndex,
  fillApplying,
  handleCheckboxClick,
  openPeek,
  peekNavigate,
  setIcon,
  setFillDrag,
}: {
  row: DatabaseRowView;
  rIdx: number;
  databaseId: string;
  visibleCols: ColumnDef[];
  isBoxSelected: boolean;
  fillDrag: FillDragState | null;
  fillHoverRowIndex: number | null;
  fillApplying: { columnId: string; sourceRowIndex: number } | null;
  handleCheckboxClick: (pageId: string, opts: { shiftKey: boolean }) => void;
  openPeek: (pageId: string) => void;
  peekNavigate: (pageId: string) => void;
  setIcon: (pageId: string, icon: string | null) => void;
  setFillDrag: (v: FillDragState | null) => void;
}) {
  const fillRangeStart = fillDrag && fillHoverRowIndex != null
    ? Math.min(fillDrag.sourceRowIndex, fillHoverRowIndex)
    : null;
  const fillRangeEnd = fillDrag && fillHoverRowIndex != null
    ? Math.max(fillDrag.sourceRowIndex, fillHoverRowIndex)
    : null;

  return (
    <tr
      data-qn-row-idx={rIdx}
      className={[
        "group/row border-b border-zinc-100 dark:border-zinc-800",
        isBoxSelected ? "bg-blue-50 dark:bg-blue-950/30" : "",
      ].join(" ")}
    >
      <td className="px-1 py-0 align-middle">
        <div className="flex h-full min-h-[28px] items-center justify-center">
          <button
            type="button"
            role="checkbox"
            aria-checked={isBoxSelected}
            aria-label="행 선택"
            onClick={(e) => {
              e.stopPropagation();
              handleCheckboxClick(row.pageId, { shiftKey: e.shiftKey });
            }}
            className={[
              "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-opacity",
              isBoxSelected
                ? "border-blue-500 bg-blue-500 text-white opacity-100"
                : "border-zinc-400 bg-transparent opacity-30 group-hover/row:opacity-100 dark:border-zinc-500",
            ].join(" ")}
          >
            {isBoxSelected ? <Check size={10} strokeWidth={3} /> : null}
          </button>
        </div>
      </td>
      {visibleCols.map((col, cIdx) => {
        const isFirst = cIdx === 0;
        const isFillRangeCell = Boolean(
          fillDrag &&
          fillDrag.columnId === col.id &&
          fillRangeStart != null && fillRangeEnd != null &&
          rIdx >= fillRangeStart && rIdx <= fillRangeEnd,
        );
        const isFillTop = isFillRangeCell && rIdx === fillRangeStart;
        const isFillBottom = isFillRangeCell && rIdx === fillRangeEnd;
        return (
          <td
            key={col.id}
            data-qn-col-id={col.id}
            className={[
              "group/cell relative align-top px-2 py-1",
              isFirst ? "overflow-visible" : "overflow-hidden",
              isFirst ? "pr-16" : "",
            ].join(" ")}
          >
            {isFillRangeCell && (
              <span
                className={[
                  "pointer-events-none absolute inset-x-[2px] z-[6]",
                  isFillTop ? "top-[2px]" : "-top-px",
                  isFillBottom ? "bottom-[2px]" : "-bottom-px",
                  "border-l border-r border-dashed border-blue-500",
                  isFillTop ? "border-t" : "",
                  isFillBottom ? "border-b" : "",
                  isFillTop && isFillBottom ? "rounded-sm" : "",
                ].join(" ")}
              />
            )}
            <div className="relative min-w-0 max-w-full truncate">
              {col.type === "title" ? (
                <div className="flex min-w-0 items-center gap-1">
                  <span className="shrink-0" onPointerDown={(e) => e.stopPropagation()}>
                    <IconPicker
                      current={row.icon ?? null}
                      size="sm"
                      onChange={(icon) => setIcon(row.pageId, icon)}
                    />
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const inPeek = Boolean(
                        (e.currentTarget as HTMLElement).closest("[data-qn-peek-editor='true']"),
                      );
                      if (inPeek) peekNavigate(row.pageId);
                      else openPeek(row.pageId);
                    }}
                    className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-sm text-zinc-900 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
                    title="사이드 피크 열기"
                  >
                    {row.title || "제목 없음"}
                  </button>
                </div>
              ) : (
                <DatabaseCell
                  databaseId={databaseId}
                  rowId={row.pageId}
                  column={col}
                  value={row.cells[col.id]}
                />
              )}
            </div>
            {col.type !== "title" && (
              <button
                type="button"
                aria-label="아래로 값 복제"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setFillDrag({ columnId: col.id, sourceRowIndex: rIdx, sourceValue: row.cells[col.id] });
                }}
                className={[
                  "absolute bottom-0 right-0 z-20 flex h-4 w-4 items-center justify-center rounded-full text-blue-600",
                  "cursor-crosshair bg-white/90 dark:bg-zinc-800/90",
                  "opacity-0 transition-opacity group-hover/cell:opacity-100",
                  fillDrag && fillDrag.columnId === col.id && fillDrag.sourceRowIndex === rIdx
                    ? "opacity-100"
                    : "",
                ].join(" ")}
              >
                <Plus size={10} strokeWidth={2.5} />
              </button>
            )}
            {fillApplying &&
              fillApplying.columnId === col.id &&
              fillApplying.sourceRowIndex === rIdx && (
                <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                  <span className="rounded bg-zinc-900/85 px-2 py-0.5 text-[10px] font-medium text-white shadow-sm">
                    복제중
                  </span>
                </span>
              )}
          </td>
        );
      })}
    </tr>
  );
});

export function DatabaseTableView({ databaseId, panelState, setPanelState, visibleRowLimit, layout }: Props) {
  void setPanelState;
  const { bundle, rows: allRows } = useProcessedRows(databaseId, panelState);
  // 표시 제한이 있으면 slice 적용.
  const rows = visibleRowLimit != null ? (allRows ?? []).slice(0, visibleRowLimit) : allRows;
  const autoFitRows = allRows ?? rows;
  const addRow = useDatabaseStore((s) => s.addRow);
  const deleteRow = useDatabaseStore((s) => s.deleteRow);
  const moveColumn = useDatabaseStore((s) => s.moveColumn);
  const updateCell = useDatabaseStore((s) => s.updateCell);
  const setIcon = usePageStore((s) => s.setIcon);
  const openPeek = useUiStore((s) => s.openPeek);
  const peekNavigate = useUiStore((s) => s.peekNavigate);
  const restoreDeletedRowFromHistory = useDatabaseStore(
    (s) => s.restoreDeletedRowFromHistory,
  );

  const [colDragFrom, setColDragFrom] = useState<number | null>(null);
  const [colDragOver, setColDragOver] = useState<number | null>(null);
  const [rowDeletePageId, setRowDeletePageId] = useState<string | null>(null);
  const [fillDrag, setFillDrag] = useState<{
    columnId: string;
    sourceRowIndex: number;
    sourceValue: CellValue;
  } | null>(null);
  const [fillApplying, setFillApplying] = useState<{
    columnId: string;
    sourceRowIndex: number;
  } | null>(null);
  const [fillHoverRowIndex, setFillHoverRowIndex] = useState<number | null>(null);

  const orderedRowIds = useMemo(
    () => (rows ? rows.map((r) => r.pageId) : []),
    [rows],
  );
  const { selectedRowIds, handleCheckboxClick, toggleAll, clearSelection } =
    useTableRowSelection(orderedRowIds);

  // 선택 액션 메뉴 (하단 "N개 선택" 드롭다운)
  const [selectionMenuOpen, setSelectionMenuOpen] = useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const selectionMenuRef = useRef<HTMLDivElement | null>(null);
  const deletedRowTombstones = useHistoryStore((s) =>
    s.getDeletedRowTombstones(databaseId),
  );
  useEffect(() => {
    if (!selectionMenuOpen) return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inSelection = selectionMenuRef.current?.contains(target);
      if (!inSelection) setSelectionMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [selectionMenuOpen]);
  // 선택이 비면 열려있던 메뉴 자동 닫기
  useEffect(() => {
    if (selectedRowIds.size === 0) setSelectionMenuOpen(false);
  }, [selectedRowIds.size]);

  // drag cancel(drop 없이 dragend) 시 컬럼 drag state 완전 리셋 안전망
  useEffect(() => {
    const cleanup = () => {
      setColDragFrom(null);
      setColDragOver(null);
      document.body.classList.remove("quicknote-db-col-dragging");
    };
    window.addEventListener("dragend", cleanup);
    return () => window.removeEventListener("dragend", cleanup);
  }, []);

  useEffect(() => {
    if (!fillDrag) return;
    const onMouseMove = (event: MouseEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const rowEl = target?.closest<HTMLTableRowElement>("tr[data-qn-row-idx]");
      const rowIdxRaw = rowEl?.dataset.qnRowIdx;
      const hoverRowIndex = rowIdxRaw != null ? Number(rowIdxRaw) : NaN;
      if (Number.isFinite(hoverRowIndex)) setFillHoverRowIndex(hoverRowIndex);
      else setFillHoverRowIndex(fillDrag.sourceRowIndex);
    };
    const onMouseUp = (event: MouseEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const rowEl = target?.closest<HTMLTableRowElement>("tr[data-qn-row-idx]");
      const rowIdxRaw = rowEl?.dataset.qnRowIdx;
      const endRowIndex = rowIdxRaw != null ? Number(rowIdxRaw) : NaN;
      if (Number.isFinite(endRowIndex) && endRowIndex !== fillDrag.sourceRowIndex) {
        setFillApplying({
          columnId: fillDrag.columnId,
          sourceRowIndex: fillDrag.sourceRowIndex,
        });
        window.setTimeout(() => {
          const start = Math.min(fillDrag.sourceRowIndex, endRowIndex);
          const end = Math.max(fillDrag.sourceRowIndex, endRowIndex);
          for (let i = start; i <= end; i += 1) {
            if (i === fillDrag.sourceRowIndex) continue;
            const targetRow = rows[i];
            if (!targetRow) continue;
            updateCell(
              databaseId,
              targetRow.pageId,
              fillDrag.columnId,
              cloneCellValue(fillDrag.sourceValue),
            );
          }
          setFillApplying(null);
        }, 0);
      }
      setFillDrag(null);
      setFillHoverRowIndex(null);
    };
    setFillHoverRowIndex(fillDrag.sourceRowIndex);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [databaseId, fillDrag, rows, updateCell]);

  // 뷰별 가시·정렬 컬럼 (#9) — memo 행 비교를 위해 참조 안정화
  const bundleColumns = bundle?.columns;
  const viewConfigs = panelState.viewConfigs;
  const visibleCols = useMemo(
    () => getVisibleOrderedColumns(bundleColumns ?? [], "table", viewConfigs),
    [bundleColumns, viewConfigs],
  );
  const resolvedColWidths = useMemo(
    () => visibleCols.map((col) => col.width ?? defaultMinWidthForType(col.type)),
    [visibleCols],
  );
  const CHECKBOX_COL = 28;
  const tableWidthPx =
    CHECKBOX_COL + resolvedColWidths.reduce((acc, w) => acc + w, 0);
  const virtualRows = useWindowedRows({
    count: rows.length,
    estimateSize: 32,
    enabled: visibleRowLimit == null && rows.length > 120,
    overscan: 10,
  });
  const renderedRows = virtualRows.enabled
    ? rows.slice(virtualRows.start, virtualRows.end)
    : rows;

  // moveColumn은 bundle.columns 기준 인덱스를 받으므로 visibleCols 인덱스를 변환.
  const colIdToBundleIdx = useMemo(
    () => new Map((bundle?.columns ?? []).map((c, i) => [c.id, i])),
    [bundle?.columns],
  );

  const onColDrop = () => {
    if (colDragFrom != null && colDragOver != null && colDragFrom !== colDragOver) {
      const fromCol = visibleCols[colDragFrom];
      const toCol = visibleCols[colDragOver];
      if (fromCol && toCol) {
        const from = colIdToBundleIdx.get(fromCol.id) ?? -1;
        const to = colIdToBundleIdx.get(toCol.id) ?? -1;
        if (from >= 0 && to >= 0) moveColumn(databaseId, from, to);
      }
    }
    // DB 컬럼 드래그 종료 — dropcursor/indicator 복구
    document.body.classList.remove("quicknote-db-col-dragging");
    setColDragFrom(null);
    setColDragOver(null);
  };

  /** 헤더 우측 리사이즈 핸들 더블클릭 → 해당 컬럼 폭을 헤더+모든 셀의 가장 긴 텍스트에 맞춰 자동 조정.
   *  inputs 의 value 와 텍스트 컨텐츠 모두 측정해 최대값 사용. */
  const autoFitColumn = useCallback(
    (columnId: string) => {
      const th = document.querySelector<HTMLTableCellElement>(
        `[data-qn-col-id="${columnId}"]`,
      );
      if (!th) return;
      const table = th.closest("table");
      const tbody = table?.querySelector("tbody");

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const headerFont = window.getComputedStyle(th).font;
      ctx.font = headerFont || "500 12px sans-serif";
      // 헤더 텍스트 + 그립/chevron/padding 여유
      const HEADER_CHROME = 56;
      let maxWidth = ctx.measureText(th.textContent ?? "").width + HEADER_CHROME;

      const sampleCell = tbody?.querySelector<HTMLTableCellElement>(`td[data-qn-col-id="${columnId}"]`);
      const cellFont = sampleCell
        ? window.getComputedStyle(sampleCell).font
        : "12px sans-serif";
      ctx.font = cellFont || "12px sans-serif";

      const CELL_PADDING = 24; // px-2 좌우 여유 + 약간의 buffer
      const TITLE_CELL_CHROME = 52;
      const col = visibleCols.find((c) => c.id === columnId);
      autoFitRows.forEach((row) => {
        const content =
          col?.type === "title"
            ? row.title
            : cellToSearchString(row.cells[columnId], visibleCols, columnId);
        const text = (content ?? "").trim();
        if (!text) return;
        const w = ctx.measureText(text).width + (col?.type === "title" ? TITLE_CELL_CHROME : CELL_PADDING);
        if (w > maxWidth) maxWidth = w;
      });

      const finalWidth = Math.max(40, Math.ceil(maxWidth));
      useDatabaseStore
        .getState()
        .updateColumn(databaseId, columnId, { width: finalWidth });
    },
    [autoFitRows, databaseId, visibleCols],
  );

  if (!bundle) return null;

  return (
    // fullPage: 페이지 스크롤에 맡겨 터치패드 스크롤이 자연스럽게 작동.
    // inline: 60vh 내에서만 스크롤.
    <div
      ref={virtualRows.containerRef}
      className={`group relative overflow-x-auto ${layout === "fullPage" ? "" : "max-h-[60vh] overflow-y-auto"}`}
    >
      {/* table-layout:fixed + w-full 조합은 한 컬럼 리사이즈 시 다른 컬럼 폭을 100%
          맞추려고 자동 재배분한다 → 사용자가 의도한 폭으로 조절 불가.
          natural-width(table-layout:fixed, no w-full) 로 두어 각 col 의 width 가 그대로 유지되게.
          parent 가 더 넓으면 좌측 정렬, 좁으면 가로 스크롤(이미 overflow-x-auto). */}
      <div className="relative" style={{ width: tableWidthPx + 40 }}>
        <table
          className="border-collapse text-left text-base"
          style={{ tableLayout: "fixed", width: `${tableWidthPx}px` }}
        >
          <colgroup>
            <col style={{ width: CHECKBOX_COL, minWidth: CHECKBOX_COL }} />
            {visibleCols.map((col, idx) => (
              <col key={col.id} style={{ width: resolvedColWidths[idx] }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-[5] bg-white dark:bg-zinc-950">
            <tr className="group/thead">
              <th className="px-0 py-0 align-middle">
                {(() => {
                  const total = orderedRowIds.length;
                  const sel = selectedRowIds.size;
                  const allChecked = total > 0 && sel === total;
                  const someChecked = sel > 0 && sel < total;
                  return (
                    <div className="flex min-h-[28px] items-center justify-center">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={allChecked ? "true" : someChecked ? "mixed" : "false"}
                        aria-label="모든 행 선택"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleAll();
                        }}
                        className={[
                          "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-opacity",
                          sel > 0
                            ? "border-blue-500 bg-blue-500 text-white opacity-100"
                            : "border-zinc-400 bg-transparent opacity-30 group-hover/thead:opacity-100 dark:border-zinc-500",
                        ].join(" ")}
                      >
                        {allChecked ? <Check size={10} strokeWidth={3} /> : someChecked ? <Minus size={10} strokeWidth={3} /> : null}
                      </button>
                    </div>
                  );
                })()}
              </th>
              {visibleCols.map((col, idx) => (
                <DatabaseColumnHeader
                  key={col.id}
                  databaseId={databaseId}
                  column={col}
                  index={idx}
                  onDragStart={(i) => setColDragFrom(i)}
                  onDragOver={(i) => setColDragOver(i)}
                  onDrop={onColDrop}
                  onAutoFit={() => autoFitColumn(col.id)}
                  highlightDrop={
                    colDragFrom != null && colDragOver === idx && colDragFrom !== idx
                      ? colDragFrom < idx ? "right" : "left"
                      : null
                  }
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {virtualRows.topPadding > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={visibleCols.length + 1}
                  style={{ height: virtualRows.topPadding, padding: 0, border: 0 }}
                />
              </tr>
            )}
            {renderedRows.map((row, localIdx) => {
              const rIdx = virtualRows.start + localIdx;
              return (
                <DatabaseTableRow
                  key={row.pageId}
                  row={row}
                  rIdx={rIdx}
                  databaseId={databaseId}
                  visibleCols={visibleCols}
                  isBoxSelected={selectedRowIds.has(row.pageId)}
                  fillDrag={fillDrag}
                  fillHoverRowIndex={fillHoverRowIndex}
                  fillApplying={fillApplying}
                  handleCheckboxClick={handleCheckboxClick}
                  openPeek={openPeek}
                  peekNavigate={peekNavigate}
                  setIcon={setIcon}
                  setFillDrag={setFillDrag}
                />
              );
            })}
            {virtualRows.bottomPadding > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={visibleCols.length + 1}
                  style={{ height: virtualRows.bottomPadding, padding: 0, border: 0 }}
                />
              </tr>
            )}
          </tbody>
        </table>
        <div className="pointer-events-auto absolute top-0 z-[12]" style={{ left: tableWidthPx + 4 }}>
          <DatabaseAddColumnButton databaseId={databaseId} />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => addRow(databaseId)}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <Plus size={14} /> 새 항목
        </button>
        <div className="flex items-center gap-2">
          {selectedRowIds.size > 0 && (
            <div className="relative" ref={selectionMenuRef}>
              <button
                type="button"
                onClick={() => setSelectionMenuOpen((v) => !v)}
                className="flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <span>{selectedRowIds.size}개 선택</span>
                <MoreHorizontal size={14} />
              </button>
              {selectionMenuOpen && (
                <div className="absolute right-0 bottom-full z-30 mb-1 w-36 rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectionMenuOpen(false);
                      setBatchDeleteOpen(true);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    <Trash2 size={12} />
                    삭제
                  </button>
                  {deletedRowTombstones[0] && (
                    <button
                      type="button"
                      onClick={() => {
                        const latest = deletedRowTombstones[0];
                        if (latest) {
                          restoreDeletedRowFromHistory(databaseId, latest.id);
                        }
                        setSelectionMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      최근 삭제 행 복구
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
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
      <SimpleConfirmDialog
        open={batchDeleteOpen}
        title="선택한 행 일괄 삭제"
        message={`${selectedRowIds.size}개 행을 삭제할까요? (연결된 페이지도 함께 삭제됩니다)`}
        confirmLabel="삭제"
        danger
        onCancel={() => setBatchDeleteOpen(false)}
        onConfirm={() => {
          // snapshot 한 뒤 삭제 — store 업데이트로 selectedRowIds 가 비워지더라도 안전
          const ids = Array.from(selectedRowIds);
          ids.forEach((id) => deleteRow(databaseId, id));
          clearSelection();
          setBatchDeleteOpen(false);
        }}
      />
    </div>
  );
}
