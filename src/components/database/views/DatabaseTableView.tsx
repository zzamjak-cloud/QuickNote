import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  GripVertical,
  ArrowUpRight,
  PanelRight,
  Check,
  Minus,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import type { DatabasePanelState } from "../../../types/database";
import { defaultMinWidthForType, getVisibleOrderedColumns } from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useProcessedRows } from "../useProcessedRows";
import { DatabaseCell } from "../DatabaseCell";
import { DatabaseColumnHeader } from "../DatabaseColumnHeader";
import { DatabaseAddColumnButton } from "../DatabaseAddColumnButton";
import { usePageStore } from "../../../store/pageStore";
import { IconPicker } from "../../common/IconPicker";
import { useSettingsStore } from "../../../store/settingsStore";
import { useUiStore } from "../../../store/uiStore";
import { SimpleConfirmDialog } from "../../ui/SimpleConfirmDialog";
import { useTableRowSelection } from "./useTableRowSelection";
import { useHistoryStore } from "../../../store/historyStore";
import { useWindowedRows } from "./useWindowedRows";

type Props = {
  databaseId: string;
  panelState: DatabasePanelState;
  setPanelState: (p: Partial<DatabasePanelState>) => void;
  /** 표시할 최대 행 수. 미지정 시 전체 표시. */
  visibleRowLimit?: number;
  layout?: "inline" | "fullPage";
};

const DRAG_MIME = "application/x-quicknote-db-drag";

export function DatabaseTableView({ databaseId, panelState, setPanelState, visibleRowLimit, layout }: Props) {
  void setPanelState;
  const { bundle, rows: allRows } = useProcessedRows(databaseId, panelState);
  // 표시 제한이 있으면 slice 적용.
  const rows = visibleRowLimit != null ? (allRows ?? []).slice(0, visibleRowLimit) : allRows;
  const addRow = useDatabaseStore((s) => s.addRow);
  const deleteRow = useDatabaseStore((s) => s.deleteRow);
  const moveColumn = useDatabaseStore((s) => s.moveColumn);
  const setRowOrder = useDatabaseStore((s) => s.setRowOrder);
  const setIcon = usePageStore((s) => s.setIcon);
  const activePageId = usePageStore((s) => s.activePageId);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const openTab = useSettingsStore((s) => s.openTab);
  const openPeek = useUiStore((s) => s.openPeek);
  const setRowBackTarget = useUiStore((s) => s.setRowBackTarget);
  const restoreDeletedRowFromHistory = useDatabaseStore(
    (s) => s.restoreDeletedRowFromHistory,
  );

  const [colDragFrom, setColDragFrom] = useState<number | null>(null);
  const [colDragOver, setColDragOver] = useState<number | null>(null);
  const [rowDragFrom, setRowDragFrom] = useState<number | null>(null);
  const [rowDragOver, setRowDragOver] = useState<number | null>(null);
  const [rowDeletePageId, setRowDeletePageId] = useState<string | null>(null);

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

  // drag cancel(drop 없이 dragend) 시 col/row drag state 완전 리셋 안전망
  useEffect(() => {
    const cleanup = () => {
      setColDragFrom(null);
      setColDragOver(null);
      setRowDragFrom(null);
      setRowDragOver(null);
      document.body.classList.remove("quicknote-db-col-dragging");
    };
    window.addEventListener("dragend", cleanup);
    return () => window.removeEventListener("dragend", cleanup);
  }, []);

  // 뷰별 가시·정렬 컬럼 (#9)
  const visibleCols = getVisibleOrderedColumns(
    bundle?.columns ?? [],
    "table",
    panelState.viewConfigs,
  );
  const resolvedColWidths = useMemo(
    () => visibleCols.map((col) => col.width ?? defaultMinWidthForType(col.type)),
    [visibleCols],
  );
  const CHECKBOX_COL = 28;
  const ADD_COL = 32;
  const tableWidthPx =
    CHECKBOX_COL + ADD_COL + resolvedColWidths.reduce((acc, w) => acc + w, 0);
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

  const onRowDrop = () => {
    if (!bundle) return;
    if (rowDragFrom != null && rowDragOver != null && rowDragFrom !== rowDragOver) {
      const order = [...bundle.rowPageOrder];
      const [m] = order.splice(rowDragFrom, 1);
      if (m) order.splice(rowDragOver, 0, m);
      setRowOrder(databaseId, order);
    }
    setRowDragFrom(null);
    setRowDragOver(null);
  };

  const openFull = (pageId: string, opts?: { newTab?: boolean }) => {
    if (activePageId) {
      setRowBackTarget(pageId, activePageId);
    }
    if (opts?.newTab) {
      openTab(pageId);
      return;
    }
    setActivePage(pageId);
    setCurrentTabPage(pageId);
  };

  /** 헤더 우측 리사이즈 핸들 더블클릭 → 해당 컬럼 폭을 헤더+모든 셀의 가장 긴 텍스트에 맞춰 자동 조정.
   *  inputs 의 value 와 텍스트 컨텐츠 모두 측정해 최대값 사용. */
  const autoFitColumn = useCallback(
    (columnId: string) => {
      // 같은 컬럼 인덱스의 본문 td 들을 찾기 위해 헤더 th 의 위치 기반 인덱스 사용
      const th = document.querySelector<HTMLTableCellElement>(
        `[data-qn-col-id="${columnId}"]`,
      );
      if (!th) return;
      const table = th.closest("table");
      if (!table) return;
      const headerCells = Array.from(th.parentElement?.children ?? []);
      const colIdx = headerCells.indexOf(th);
      if (colIdx < 0) return;
      const tbody = table.querySelector("tbody");

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const headerFont = window.getComputedStyle(th).font;
      ctx.font = headerFont || "500 12px sans-serif";
      // 헤더 텍스트 + 그립/chevron/padding 여유
      const HEADER_CHROME = 56;
      let maxWidth = ctx.measureText(th.textContent ?? "").width + HEADER_CHROME;

      const sampleCell = tbody?.querySelector<HTMLTableCellElement>("td");
      const cellFont = sampleCell
        ? window.getComputedStyle(sampleCell).font
        : "12px sans-serif";
      ctx.font = cellFont || "12px sans-serif";

      const CELL_PADDING = 24; // px-2 좌우 여유 + 약간의 buffer
      tbody?.querySelectorAll<HTMLTableRowElement>("tr").forEach((tr) => {
        const cell = tr.children[colIdx] as HTMLElement | undefined;
        if (!cell) return;
        // textContent 와 모든 input/textarea value 중 가장 긴 텍스트 사용
        const textContent = (cell.textContent ?? "").trim();
        let longest = textContent;
        cell.querySelectorAll<HTMLInputElement>("input, textarea").forEach((el) => {
          if (el.type === "checkbox") return;
          if (el.value && el.value.length > longest.length) longest = el.value;
        });
        if (!longest) return;
        const w = ctx.measureText(longest).width + CELL_PADDING;
        if (w > maxWidth) maxWidth = w;
      });

      const finalWidth = Math.max(40, Math.ceil(maxWidth));
      useDatabaseStore
        .getState()
        .updateColumn(databaseId, columnId, { width: finalWidth });
    },
    [databaseId],
  );

  if (!bundle) return null;

  return (
    // fullPage: 페이지 스크롤에 맡겨 터치패드 스크롤이 자연스럽게 작동.
    // inline: 60vh 내에서만 스크롤.
    <div
      ref={virtualRows.containerRef}
      className={`relative overflow-x-auto ${layout === "fullPage" ? "" : "max-h-[60vh] overflow-y-auto"}`}
    >
      {/* table-layout:fixed + w-full 조합은 한 컬럼 리사이즈 시 다른 컬럼 폭을 100%
          맞추려고 자동 재배분한다 → 사용자가 의도한 폭으로 조절 불가.
          natural-width(table-layout:fixed, no w-full) 로 두어 각 col 의 width 가 그대로 유지되게.
          parent 가 더 넓으면 좌측 정렬, 좁으면 가로 스크롤(이미 overflow-x-auto). */}
      <table
        className="border-collapse text-left text-sm"
        style={{ tableLayout: "fixed", width: `${tableWidthPx}px` }}
      >
        <colgroup>
          {/* 선택 체크박스 컬럼 */}
          <col style={{ width: 28, minWidth: 28 }} />
          {visibleCols.map((col, idx) => (
            <col key={col.id} style={{ width: resolvedColWidths[idx] }} />
          ))}
          {/* + 버튼 컬럼 */}
          <col style={{ width: 32, minWidth: 32 }} />
        </colgroup>
        <thead className="sticky top-0 z-[5] bg-white dark:bg-zinc-950">
          <tr>
            <th className="px-1 py-1 text-center align-middle">
              {(() => {
                const total = orderedRowIds.length;
                const sel = selectedRowIds.size;
                const allChecked = total > 0 && sel === total;
                const someChecked = sel > 0 && sel < total;
                return (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={
                      allChecked ? "true" : someChecked ? "mixed" : "false"
                    }
                    aria-label="모든 행 선택"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleAll();
                    }}
                    className={[
                      "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-opacity",
                      sel > 0
                        ? "border-blue-500 bg-blue-500 text-white opacity-100"
                        : "border-zinc-400 bg-transparent opacity-30 hover:opacity-100 dark:border-zinc-500",
                    ].join(" ")}
                  >
                    {allChecked ? (
                      <Check size={10} strokeWidth={3} />
                    ) : someChecked ? (
                      <Minus size={10} strokeWidth={3} />
                    ) : null}
                  </button>
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
            <DatabaseAddColumnButton databaseId={databaseId} />
          </tr>
        </thead>
        <tbody>
          {virtualRows.topPadding > 0 && (
            <tr aria-hidden="true">
              <td
                colSpan={visibleCols.length + 2}
                style={{ height: virtualRows.topPadding, padding: 0, border: 0 }}
              />
            </tr>
          )}
          {renderedRows.map((row, localIdx) => {
            const rIdx = virtualRows.start + localIdx;
            const isDropTarget = rowDragFrom != null && rowDragOver === rIdx && rowDragFrom !== rIdx;
            const isBoxSelected = selectedRowIds.has(row.pageId);
            return (
              <tr
                key={row.pageId}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setRowDragOver(rIdx);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onRowDrop();
                }}
                className={[
                  "group border-b border-zinc-100 dark:border-zinc-800",
                  isDropTarget ? "border-t-2 border-dashed border-t-blue-400" : "",
                  isBoxSelected
                    ? "bg-blue-50 dark:bg-blue-950/30"
                    : "",
                ].join(" ")}
              >
                {/* 행 선택 체크박스 — 평소엔 희미, hover/체크 시 진하게. Shift+클릭 으로 범위 선택.
                    native input 의 controlled state 갱신 타이밍 이슈를 피하려 button + aria-checked 로 구현. */}
                <td className="px-1 py-0 align-middle">
                  <div className="flex h-full min-h-[28px] items-center justify-center">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isBoxSelected}
                    aria-label="행 선택"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCheckboxClick(row.pageId, {
                        shiftKey: e.shiftKey,
                      });
                    }}
                    className={[
                      "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-opacity",
                      isBoxSelected
                        ? "border-blue-500 bg-blue-500 text-white opacity-100"
                        : "border-zinc-400 bg-transparent opacity-30 group-hover:opacity-100 dark:border-zinc-500",
                    ].join(" ")}
                  >
                    {isBoxSelected ? (
                      <Check size={10} strokeWidth={3} />
                    ) : null}
                  </button>
                  </div>
                </td>
                {visibleCols.map((col, cIdx) => {
                  const isFirst = cIdx === 0;
                  return (
                    <td
                      key={col.id}
                      className={[
                        "align-top overflow-hidden px-2 py-1",
                        isFirst ? "relative pr-16" : "",
                      ].join(" ")}
                    >
                      {isFirst && (
                        <span
                          draggable
                          onDragStart={(e) => {
                            e.stopPropagation();
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData(DRAG_MIME, `row:${rIdx}`);
                            setRowDragFrom(rIdx);
                          }}
                          onDragEnd={(e) => {
                            e.stopPropagation();
                            setRowDragFrom(null);
                            setRowDragOver(null);
                          }}
                          className="absolute left-[-18px] top-1/2 -translate-y-1/2 cursor-grab opacity-0 group-hover:opacity-100 active:cursor-grabbing"
                          title="행 이동"
                        >
                          <GripVertical size={12} className="text-zinc-400" />
                        </span>
                      )}
                      {/*
                        셀 컨텐츠 클리핑(#2): truncate(=overflow:hidden+ellipsis+nowrap)을
                        wrapper에 적용해 텍스트가 다음 컬럼으로 침범하지 않도록.
                        input 등 자식 요소는 wrapper width(=cell width)에 맞춰 자연 클립.
                      */}
                      <div className="min-w-0 max-w-full truncate">
                        {col.type === "title" ? (
                          <div className="flex min-w-0 items-center gap-1">
                            <span className="shrink-0" onPointerDown={(e) => e.stopPropagation()}>
                              <IconPicker
                                current={row.icon ?? null}
                                size="sm"
                                onChange={(icon) => setIcon(row.pageId, icon)}
                              />
                            </span>
                            <div className="min-w-0 flex-1 truncate">
                              <DatabaseCell
                                databaseId={databaseId}
                                rowId={row.pageId}
                                column={col}
                                value={row.title}
                              />
                            </div>
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
                      {isFirst && (
                        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded bg-white/90 opacity-0 backdrop-blur-sm group-hover:opacity-100 dark:bg-zinc-950/90">
                          <button
                            type="button"
                            onClick={(e) =>
                              openFull(row.pageId, {
                                newTab: e.metaKey || e.ctrlKey,
                              })
                            }
                            title="페이지로 열기"
                            className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                          >
                            <ArrowUpRight size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => openPeek(row.pageId)}
                            title="사이드 피크 열기"
                            className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                          >
                            <PanelRight size={12} />
                          </button>
                        </div>
                      )}
                    </td>
                  );
                })}
                {/* "+" 헤더와 cell 수 일치 */}
                <td />
              </tr>
            );
          })}
          {virtualRows.bottomPadding > 0 && (
            <tr aria-hidden="true">
              <td
                colSpan={visibleCols.length + 2}
                style={{ height: virtualRows.bottomPadding, padding: 0, border: 0 }}
              />
            </tr>
          )}
        </tbody>
      </table>
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
