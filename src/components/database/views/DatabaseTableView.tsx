import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Check,
  Minus,
  MoreHorizontal,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { DatabasePanelState, ColumnDef, DatabaseRowView, CellValue } from "../../../types/database";
import {
  defaultMinWidthForType,
  getVisibleOrderedColumns,
  moveVisibleColumnInViewConfig,
  setColumnVisibleInViewConfig,
} from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useDatabaseGroupCollapseStore } from "../../../store/databaseGroupCollapseStore";
import {
  databasePageTreeCollapseKey,
  useDatabasePageTreeCollapseStore,
} from "../../../store/databasePageTreeCollapseStore";
import { useUiStore } from "../../../store/uiStore";
import { useProcessedRows } from "../useProcessedRows";
import { useRowGroups } from "../useRowGroups";
import { GroupSectionHeader } from "../GroupSectionHeader";
import { DatabaseCell } from "../DatabaseCell";
import { DatabaseColumnHeader } from "../DatabaseColumnHeader";
import { DatabaseAddColumnButton } from "../DatabaseAddColumnButton";
import { usePageStore } from "../../../store/pageStore";
import { IconPicker } from "../../common/IconPicker";
import { SimpleConfirmDialog } from "../../ui/SimpleConfirmDialog";
import { useTableRowSelection } from "./useTableRowSelection";
import { useHistoryStore } from "../../../store/historyStore";
import { useWindowedRows } from "./useWindowedRows";
import { cellToSearchString, resolveActiveFilterRules } from "../../../lib/databaseQuery";
import { useAddDatabaseRowAndOpen, useOpenDatabaseRow } from "../useOpenDatabaseRow";
import { DatabasePageSubtree } from "../DatabasePageSubtree";
import { collectPageTreePath } from "../../page/pageSubpageTreeUtils";
import { useOpenPageInPeek } from "../../page/useOpenPageInPeek";
import { useShallow } from "zustand/react/shallow";

// pageTree 미사용 시 selector 가 반환할 고정 빈 Set — 매 렌더 새 Set 생성으로 인한 불필요 리렌더 방지.
const EMPTY_PARENT_SET: ReadonlySet<string> = new Set<string>();

type Props = {
  databaseId: string;
  panelState: DatabasePanelState;
  setPanelState: (p: Partial<DatabasePanelState>) => void;
  /** 표시할 최대 행 수. 미지정 시 전체 표시. */
  visibleRowLimit?: number;
};

function cloneCellValue<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

type FillDragState = { columnId: string; sourceRowIndex: number; sourceValue: CellValue };

// props 얕은 비교: row/isBoxSelected/fill 관여 여부 변경 시만 리렌더. 셀 편집·타행 fill 드래그 시 리렌더하지 않음.
const DatabaseTableRow = memo(function DatabaseTableRow({
  row,
  rIdx,
  databaseId,
  visibleCols,
  isBoxSelected,
  hasChildren,
  fillRangeStart,
  fillRangeEnd,
  fillSourceColumnId,
  isFillSourceRow,
  isFillApplyingRow,
  handleCheckboxClick,
  openRow,
  setIcon,
  setFillDrag,
  pageTreeEnabled,
}: {
  row: DatabaseRowView;
  rIdx: number;
  databaseId: string;
  visibleCols: ColumnDef[];
  isBoxSelected: boolean;
  hasChildren: boolean;
  /** fill 드래그 범위(평면 rIdx). 이 행이 범위 밖이면 null 들이 전달돼 memo 가 리렌더를 건너뛴다. */
  fillRangeStart: number | null;
  fillRangeEnd: number | null;
  /** fill 드래그 대상 컬럼 id (범위 표시 테두리 그릴 컬럼) */
  fillSourceColumnId: string | null;
  /** 이 행이 fill 드래그의 소스 행인지 (소스 셀 핸들 강조) */
  isFillSourceRow: boolean;
  /** 이 행이 fill 적용중(복제중) 소스 행인지 */
  isFillApplyingRow: boolean;
  handleCheckboxClick: (pageId: string, opts: { shiftKey: boolean }) => void;
  openRow: (pageId: string, opts?: { navigateInPeek?: boolean }) => void;
  setIcon: (pageId: string, icon: string | null) => void;
  setFillDrag: (v: FillDragState | null) => void;
  pageTreeEnabled: boolean;
}) {
  const createPage = usePageStore((s) => s.createPage);
  const rootTreeCollapsed = useDatabasePageTreeCollapseStore((s) =>
    pageTreeEnabled && hasChildren
      ? s.collapsedByKey[databasePageTreeCollapseKey(databaseId, row.pageId)] !== false
      : false,
  );
  const setTreeCollapsed = useDatabasePageTreeCollapseStore((s) => s.setCollapsed);
  const toggleTreeCollapsed = useDatabasePageTreeCollapseStore((s) => s.toggle);
  const focusRequest = useUiStore((s) => s.databaseTreeFocusRequest);
  const requestDatabaseTreeFocus = useUiStore((s) => s.requestDatabaseTreeFocus);
  const openPageInPeek = useOpenPageInPeek();
  const hasPageTree = pageTreeEnabled && hasChildren;

  const createChildPage = (target: HTMLElement) => {
    const newPageId = createPage("새 페이지", row.pageId, { activate: false });
    requestDatabaseTreeFocus(databaseId, newPageId);
    setTreeCollapsed(databaseId, row.pageId, false);
    void openPageInPeek(newPageId, {
      navigateInPeek: Boolean(target.closest("[data-qn-peek-editor='true']")),
      source: "database-table-create-child-page",
    });
  };

  useEffect(() => {
    if (!pageTreeEnabled) return;
    if (!focusRequest || focusRequest.databaseId !== databaseId) return;
    // focusRequest 변동 시에만 동작하는 단발 효과 — pages 전량 구독 대신 getState() 로 즉시 조회.
    const pages = usePageStore.getState().pages;
    if (collectPageTreePath(focusRequest.pageId, pages, row.pageId).length === 0) return;
    setTreeCollapsed(databaseId, row.pageId, false);
  }, [databaseId, focusRequest, pageTreeEnabled, row.pageId, setTreeCollapsed]);

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
        const wrapText = col.config?.wrapText === true;
        const isFillRangeCell = Boolean(
          fillSourceColumnId === col.id &&
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
            <div
              className={[
                "relative min-w-0 max-w-full",
                col.type === "title" && hasPageTree
                  ? "whitespace-normal"
                  : wrapText
                  ? "whitespace-normal break-words"
                  : "max-h-[24px] overflow-hidden whitespace-nowrap",
              ].join(" ")}
            >
              {col.type === "title" ? (
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="group/tree flex min-w-0 items-center gap-1">
                    {pageTreeEnabled ? (
                      hasPageTree ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleTreeCollapsed(databaseId, row.pageId);
                          }}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                          aria-label={rootTreeCollapsed ? "하위 페이지 펼치기" : "하위 페이지 접기"}
                        >
                          {rootTreeCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        </button>
                      ) : (
                        <span className="block h-5 w-5 shrink-0" aria-hidden />
                      )
                    ) : null}
                    <span className="shrink-0" onPointerDown={(e) => e.stopPropagation()}>
                      <IconPicker
                        current={row.icon ?? null}
                        size="sm"
                        onChange={(icon) => setIcon(row.pageId, icon)}
                      />
                    </span>
                    <button
                      type="button"
                      data-qn-page-tree-node={row.pageId}
                      onClick={(e) => {
                        e.stopPropagation();
                        const inPeek = Boolean(
                          (e.currentTarget as HTMLElement).closest("[data-qn-peek-editor='true']"),
                        );
                        openRow(row.pageId, { navigateInPeek: inPeek });
                      }}
                      className={[
                        "min-w-0 flex-1 rounded px-1 py-0.5 text-left text-sm text-zinc-900 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800",
                        wrapText || hasPageTree ? "whitespace-normal break-words" : "truncate",
                      ].join(" ")}
                      title="사이드 피크 열기"
                    >
                      {row.title || "제목 없음"}
                    </button>
                    {pageTreeEnabled ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          createChildPage(event.currentTarget);
                        }}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-400 opacity-0 transition hover:bg-zinc-100 hover:text-zinc-700 group-hover/tree:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                        aria-label="하위 페이지 추가"
                        title="하위 페이지 추가"
                      >
                        <Plus size={13} />
                      </button>
                    ) : null}
                  </div>
                  {hasPageTree && !rootTreeCollapsed && (
                    <DatabasePageSubtree
                      databaseId={databaseId}
                      rootPageId={row.pageId}
                      className="pb-1"
                      compact
                    />
                  )}
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
                  isFillSourceRow && fillSourceColumnId === col.id
                    ? "opacity-100"
                    : "",
                ].join(" ")}
              >
                <Plus size={10} strokeWidth={2.5} />
              </button>
            )}
            {isFillApplyingRow &&
              fillSourceColumnId === col.id && (
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

export function DatabaseTableView({ databaseId, panelState, setPanelState, visibleRowLimit }: Props) {
  const { bundle, rows: allRows } = useProcessedRows(databaseId, panelState);
  const pageTreeEnabled = panelState.pageTreeEnabled === true;
  // 페이지 트리 기능이 켜진 경우에만 pages 를 구독해 "직접 자식 보유 페이지" 집합을 1회 파생한다.
  // 노드의 전체 후손 수 > 0 ⟺ 직접 자식 1개 이상 보유이므로, 행마다 트리를 재구축(O(n)·정렬)하던
  // countPageDescendants 를 O(1) Set 조회로 대체한다. 트리 미사용 뷰는 pages 구독 자체를 안 함.
  const parentIdsWithChildren = usePageStore(
    useShallow((s): ReadonlySet<string> => {
      if (!pageTreeEnabled) return EMPTY_PARENT_SET;
      const set = new Set<string>();
      for (const page of Object.values(s.pages)) {
        if (page.parentId) set.add(page.parentId);
      }
      return set;
    }),
  );
  // 표시 제한이 있으면 slice 적용.
  const rows = visibleRowLimit != null ? (allRows ?? []).slice(0, visibleRowLimit) : allRows;
  const autoFitRows = allRows ?? rows;
  const groups = useRowGroups(rows, bundle?.columns ?? [], panelState.groupByColumnId);
  const isGroupCollapsed = useDatabaseGroupCollapseStore((s) => s.isCollapsed);
  const toggleGroupCollapsed = useDatabaseGroupCollapseStore((s) => s.toggle);
  // fill-drag·렌더 공통 기준 행 목록. 그룹화 시 그룹 순서로 평탄화(person 다중값은 중복 가능).
  // rIdx 는 이 배열의 인덱스이므로 fill 핸들러도 동일 배열을 참조해야 일관된다.
  const effectiveRows = useMemo(
    () => (groups ? groups.flatMap((g) => g.rows) : rows),
    [groups, rows],
  );
  const deleteRow = useDatabaseStore((s) => s.deleteRow);
  const updateCell = useDatabaseStore((s) => s.updateCell);
  const setIcon = usePageStore((s) => s.setIcon);
  const openRow = useOpenDatabaseRow(databaseId);
  const addRowAndOpen = useAddDatabaseRowAndOpen(databaseId);
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
    if (selectedRowIds.size === 0 && selectionMenuOpen) setSelectionMenuOpen(false);
  }, [selectedRowIds.size, selectionMenuOpen]);

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
            const targetRow = effectiveRows[i];
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
  }, [databaseId, fillDrag, effectiveRows, updateCell]);

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
  const hasPageTreeRows = useMemo(
    () => pageTreeEnabled && rows.some((row) => parentIdsWithChildren.has(row.pageId)),
    [pageTreeEnabled, parentIdsWithChildren, rows],
  );
  const CHECKBOX_COL = 28;
  const tableWidthPx =
    CHECKBOX_COL + resolvedColWidths.reduce((acc, w) => acc + w, 0);
  const virtualRows = useWindowedRows({
    count: rows.length,
    estimateSize: 32,
    // 그룹화/하위 페이지 트리 활성 시 가상화 비활성(가변 높이 row와 평면 윈도잉이 충돌).
    enabled: !groups && !hasPageTreeRows && visibleRowLimit == null && rows.length > 120,
    overscan: 10,
  });
  const renderedRows = useMemo(
    () =>
      virtualRows.enabled
        ? rows.slice(virtualRows.start, virtualRows.end)
        : rows,
    [rows, virtualRows.enabled, virtualRows.end, virtualRows.start],
  );

  const onColDrop = () => {
    if (colDragFrom != null && colDragOver != null && colDragFrom !== colDragOver) {
      const columns = bundle?.columns ?? [];
      if (columns.length > 0) {
        const cfg = panelState.viewConfigs?.table ?? {};
        const nextCfg = moveVisibleColumnInViewConfig(
          columns,
          "table",
          cfg,
          colDragFrom,
          colDragOver,
        );
        setPanelState({
          viewConfigs: {
            ...(panelState.viewConfigs ?? {}),
            table: { ...cfg, ...nextCfg },
          },
        });
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

  // fill 드래그 상태를 전 행에 통째로 전파하면 드래그 중 모든 행이 리렌더된다.
  // 여기서 1회 파생해, 각 행에는 자신이 관여하는 정보(범위 경계·소스 행 여부)만 좁혀 전달한다.
  // → 드래그 시 실제로 범위에 들고나는 행만 리렌더(memo 가 나머지를 차단).
  const fillRangeStart =
    fillDrag && fillHoverRowIndex != null
      ? Math.min(fillDrag.sourceRowIndex, fillHoverRowIndex)
      : null;
  const fillRangeEnd =
    fillDrag && fillHoverRowIndex != null
      ? Math.max(fillDrag.sourceRowIndex, fillHoverRowIndex)
      : null;
  // 범위 표시용 컬럼: 드래그 중엔 fillDrag, 적용중(드래그 종료 후)엔 fillApplying 의 컬럼.
  const fillSourceColumnId = fillDrag?.columnId ?? fillApplying?.columnId ?? null;
  const fillSourceRowIndex = fillDrag?.sourceRowIndex ?? null;
  const fillApplyingRowIndex = fillApplying?.sourceRowIndex ?? null;

  // 그룹/평면 공통 행 렌더 — rIdx 는 effectiveRows 기준 평면 인덱스(fill-drag 일관성).
  const renderTableRow = (row: DatabaseRowView, rIdx: number, key: string) => {
    const inFillRange =
      fillRangeStart != null && fillRangeEnd != null &&
      rIdx >= fillRangeStart && rIdx <= fillRangeEnd;
    return (
      <DatabaseTableRow
        key={key}
        row={row}
        rIdx={rIdx}
        databaseId={databaseId}
        visibleCols={visibleCols}
        isBoxSelected={selectedRowIds.has(row.pageId)}
        hasChildren={pageTreeEnabled && parentIdsWithChildren.has(row.pageId)}
        // 범위 밖 행은 null 경계를 받아 memo 가 리렌더를 건너뛴다(드래그 중에도 미관여 행 안정).
        fillRangeStart={inFillRange ? fillRangeStart : null}
        fillRangeEnd={inFillRange ? fillRangeEnd : null}
        fillSourceColumnId={
          inFillRange || rIdx === fillApplyingRowIndex ? fillSourceColumnId : null
        }
        isFillSourceRow={rIdx === fillSourceRowIndex}
        isFillApplyingRow={rIdx === fillApplyingRowIndex}
        handleCheckboxClick={handleCheckboxClick}
        openRow={openRow}
        setIcon={setIcon}
        setFillDrag={setFillDrag}
        pageTreeEnabled={pageTreeEnabled}
      />
    );
  };

  return (
    <div
      ref={virtualRows.containerRef}
      className="qn-database-subtle-scrollbar group relative overflow-x-auto"
    >
      {/* table-layout:fixed + w-full 조합은 한 컬럼 리사이즈 시 다른 컬럼 폭을 100%
          맞추려고 자동 재배분한다 → 사용자가 의도한 폭으로 조절 불가.
          natural-width(table-layout:fixed, no w-full) 로 두어 각 col 의 width 가 그대로 유지되게.
          parent 가 더 넓으면 좌측 정렬, 좁으면 가로 스크롤(이미 overflow-x-auto). */}
      <div className="relative" style={{ width: tableWidthPx + 40 }}>
        <table
          className="qn-database-table border-separate border-spacing-0 text-left text-base"
          style={{ tableLayout: "fixed", width: `${tableWidthPx}px` }}
        >
          <colgroup>
            <col style={{ width: CHECKBOX_COL, minWidth: CHECKBOX_COL }} />
            {visibleCols.map((col, idx) => (
              <col key={col.id} style={{ width: resolvedColWidths[idx] }} />
            ))}
          </colgroup>
          <thead className="bg-white dark:bg-zinc-950">
            <tr className="group/thead">
              <th className="sticky top-0 z-[6] border-b border-zinc-100 bg-white px-0 py-0 align-middle dark:border-zinc-800 dark:bg-zinc-950">
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
                  onHideColumn={() => {
                    const cfg = panelState.viewConfigs?.["table"] ?? {};
                    const nextCfg = setColumnVisibleInViewConfig(
                      bundle?.columns ?? [],
                      "table",
                      cfg,
                      col.id,
                      false,
                    );
                    setPanelState({
                      viewConfigs: {
                        ...(panelState.viewConfigs ?? {}),
                        table: { ...cfg, ...nextCfg },
                      },
                    });
                  }}
                />
              ))}
            </tr>
          </thead>
          {groups ? (
            // 그룹화 렌더 — 그룹별 <tbody> + colSpan 그룹 헤더 <tr>. rIdx 는 그룹 순서 누적 인덱스.
            groups.map((group, gi) => {
              const collapsed = isGroupCollapsed(databaseId, "table", group.key);
              // baseIdx 는 effectiveRows(=groups.flatMap(g=>g.rows)) 인덱스와 정합해야 한다.
              // effectiveRows 가 collapsed 여부와 무관하게 전체 행을 포함하므로, 여기서도
              // 접힘 여부와 무관하게 이전 그룹들의 전체 행 수를 누적한다(불변식: 둘 다 전체 행 기준).
              const baseIdx = groups
                .slice(0, gi)
                .reduce((acc, g) => acc + g.rows.length, 0);
              return (
                <tbody key={group.key}>
                  <tr>
                    <td
                      colSpan={visibleCols.length + 1}
                      // 그룹 간 간격 — 첫 그룹을 제외하고 위쪽 여백을 둬 단위를 분리한다.
                      className={[
                        "border-b border-zinc-100 px-1 pb-1 dark:border-zinc-800",
                        gi > 0 ? "pt-6" : "pt-1",
                      ].join(" ")}
                    >
                      <GroupSectionHeader
                        label={group.label}
                        collapsed={collapsed}
                        onToggle={() => toggleGroupCollapsed(databaseId, "table", group.key)}
                      />
                    </td>
                  </tr>
                  {!collapsed &&
                    group.rows.map((row, li) =>
                      renderTableRow(row, baseIdx + li, `${group.key}:${row.pageId}`),
                    )}
                </tbody>
              );
            })
          ) : (
            <tbody>
              {virtualRows.topPadding > 0 && (
                <tr aria-hidden="true">
                  <td
                    colSpan={visibleCols.length + 1}
                    style={{ height: virtualRows.topPadding, padding: 0, border: 0 }}
                  />
                </tr>
              )}
              {renderedRows.map((row, localIdx) =>
                renderTableRow(row, virtualRows.start + localIdx, row.pageId),
              )}
              {virtualRows.bottomPadding > 0 && (
                <tr aria-hidden="true">
                  <td
                    colSpan={visibleCols.length + 1}
                    style={{ height: virtualRows.bottomPadding, padding: 0, border: 0 }}
                  />
                </tr>
              )}
            </tbody>
          )}
        </table>
        <div className="pointer-events-auto absolute top-0 z-[12]" style={{ left: tableWidthPx + 4 }}>
          <DatabaseAddColumnButton
            databaseId={databaseId}
            onAfterAdd={(colId) => {
              const cfg = panelState.viewConfigs?.["table"];
              if (cfg?.visibleColumnIds) {
                const columns = useDatabaseStore.getState().databases[databaseId]?.columns ?? [];
                const nextCfg = setColumnVisibleInViewConfig(
                  columns,
                  "table",
                  cfg,
                  colId,
                  true,
                );
                setPanelState({
                  viewConfigs: {
                    ...(panelState.viewConfigs ?? {}),
                    table: { ...cfg, ...nextCfg },
                  },
                });
              }
            }}
          />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() =>
            void addRowAndOpen(resolveActiveFilterRules(panelState), {
              source: "database-table-add-row-open",
            })
          }
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
