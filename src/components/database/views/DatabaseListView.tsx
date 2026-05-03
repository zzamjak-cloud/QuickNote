import { useState } from "react";
import { ArrowUpRight, GripVertical, PanelRight, Plus, X } from "lucide-react";
import type { DatabasePanelState } from "../../../types/database";
import {
  defaultMinWidthForType,
  getVisibleOrderedColumns,
} from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useProcessedRows } from "../useProcessedRows";
import { DatabaseCell } from "../DatabaseCell";
import { DatabaseColumnHeader } from "../DatabaseColumnHeader";
import { DatabaseColumnSettingsButton } from "../DatabaseColumnSettingsButton";
import { usePageStore } from "../../../store/pageStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { useUiStore } from "../../../store/uiStore";

type Props = {
  databaseId: string;
  panelState: DatabasePanelState;
  setPanelState: (p: Partial<DatabasePanelState>) => void;
};

const DRAG_MIME = "application/x-quicknote-db-drag";

/**
 * 리스트 뷰 — 표 뷰와 동일한 <table>+<colgroup> 구조를 사용해
 * 헤더와 행 정렬, 컬럼 리사이즈, 셀 클리핑을 동일하게 보장한다.
 * 시각 차이: 컬럼 사이 vertical line 제거, 가로 border만 미세하게.
 */
export function DatabaseListView({
  databaseId,
  panelState,
  setPanelState,
}: Props) {
  const { bundle, rows } = useProcessedRows(databaseId, panelState);
  const addRow = useDatabaseStore((s) => s.addRow);
  const deleteRow = useDatabaseStore((s) => s.deleteRow);
  const moveColumn = useDatabaseStore((s) => s.moveColumn);
  const setRowOrder = useDatabaseStore((s) => s.setRowOrder);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const openPeek = useUiStore((s) => s.openPeek);

  const [colDragFrom, setColDragFrom] = useState<number | null>(null);
  const [colDragOver, setColDragOver] = useState<number | null>(null);
  const [rowDragFrom, setRowDragFrom] = useState<number | null>(null);
  const [rowDragOver, setRowDragOver] = useState<number | null>(null);

  if (!bundle) return null;

  const visibleCols = getVisibleOrderedColumns(
    bundle.columns,
    "list",
    panelState.viewConfigs,
  );

  // 표 뷰와 동일한 bundle 인덱스 변환 (moveColumn은 bundle 기준).
  const colIdToBundleIdx = new Map(
    bundle.columns.map((c, i) => [c.id, i]),
  );

  const onColDrop = () => {
    if (
      colDragFrom != null &&
      colDragOver != null &&
      colDragFrom !== colDragOver
    ) {
      const fromCol = visibleCols[colDragFrom];
      const toCol = visibleCols[colDragOver];
      if (fromCol && toCol) {
        const from = colIdToBundleIdx.get(fromCol.id) ?? -1;
        const to = colIdToBundleIdx.get(toCol.id) ?? -1;
        if (from >= 0 && to >= 0) moveColumn(databaseId, from, to);
      }
    }
    setColDragFrom(null);
    setColDragOver(null);
  };

  const openFull = (pageId: string) => {
    setActivePage(pageId);
    setCurrentTabPage(pageId);
  };

  const onRowDrop = () => {
    if (
      rowDragFrom != null &&
      rowDragOver != null &&
      rowDragFrom !== rowDragOver
    ) {
      const order = [...bundle.rowPageOrder];
      const [m] = order.splice(rowDragFrom, 1);
      if (m) order.splice(rowDragOver, 0, m);
      setRowOrder(databaseId, order);
    }
    setRowDragFrom(null);
    setRowDragOver(null);
  };

  return (
    // 헤더 sticky를 위한 wrapper: 가로/세로 스크롤 모두 허용.
    <div className="max-h-[60vh] overflow-x-auto overflow-y-auto">
      <table
        className="w-full border-collapse text-left text-xs"
        style={{ tableLayout: "fixed" }}
      >
        <colgroup>
          {visibleCols.map((col) => {
            const minW = defaultMinWidthForType(col.type);
            return (
              <col
                key={col.id}
                style={{ width: col.width ?? minW, minWidth: minW }}
              />
            );
          })}
          {/* 우측 설정 버튼 컬럼 */}
          <col style={{ width: 32, minWidth: 32 }} />
        </colgroup>
        <thead className="sticky top-0 z-[5] bg-white dark:bg-zinc-950">
          <tr>
            {visibleCols.map((col, idx) => (
              <DatabaseColumnHeader
                key={col.id}
                databaseId={databaseId}
                column={col}
                index={idx}
                onDragStart={(i) => setColDragFrom(i)}
                onDragOver={(i) => setColDragOver(i)}
                onDrop={onColDrop}
                highlightDrop={
                  colDragFrom != null &&
                  colDragOver === idx &&
                  colDragFrom !== idx
                    ? colDragFrom < idx
                      ? "right"
                      : "left"
                    : null
                }
              />
            ))}
            <DatabaseColumnSettingsButton
              databaseId={databaseId}
              viewKind="list"
              panelState={panelState}
              setPanelState={setPanelState}
              asTh
            />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rIdx) => {
            const isDropTarget =
              rowDragFrom != null &&
              rowDragOver === rIdx &&
              rowDragFrom !== rIdx;
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
                  // 리스트 시각적 차이: 가로 border 미세, 세로 border 없음, hover 강조.
                  "group border-b border-zinc-100/60 hover:bg-zinc-50/60 dark:border-zinc-800/70 dark:hover:bg-zinc-900/40",
                  isDropTarget
                    ? "border-t-2 border-dashed border-t-blue-400"
                    : "",
                ].join(" ")}
              >
                {visibleCols.map((col, cIdx) => {
                  const isFirst = cIdx === 0;
                  const value =
                    col.type === "title" ? row.title : row.cells[col.id];
                  return (
                    <td
                      key={col.id}
                      className={[
                        "align-middle overflow-hidden px-2 py-1",
                        isFirst ? "relative pr-16" : "",
                      ].join(" ")}
                    >
                      {isFirst && (
                        <span
                          draggable
                          onDragStart={(e) => {
                            e.stopPropagation();
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData(
                              DRAG_MIME,
                              `row:${rIdx}`,
                            );
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
                          <GripVertical
                            size={12}
                            className="text-zinc-400"
                          />
                        </span>
                      )}
                      {/* 셀 컨텐츠 클리핑 — truncate로 컬럼 폭 안에서 잘리게. */}
                      <div className="min-w-0 max-w-full truncate">
                        <DatabaseCell
                          databaseId={databaseId}
                          rowId={row.pageId}
                          column={col}
                          value={value}
                        />
                      </div>
                      {isFirst && (
                        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded bg-white/90 opacity-0 backdrop-blur-sm group-hover:opacity-100 dark:bg-zinc-950/90">
                          <button
                            type="button"
                            onClick={() => openFull(row.pageId)}
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
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm(
                                  "이 행을 삭제할까요? (연결된 페이지도 삭제됩니다)",
                                )
                              ) {
                                deleteRow(databaseId, row.pageId);
                              }
                            }}
                            title="행 삭제"
                            className="rounded p-0.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      )}
                    </td>
                  );
                })}
                {/* 헤더의 설정 버튼 컬럼과 셀 수 일치 */}
                <td />
              </tr>
            );
          })}
        </tbody>
      </table>
      <button
        type="button"
        onClick={() => addRow(databaseId)}
        className="mt-2 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        <Plus size={14} /> 새 항목
      </button>
    </div>
  );
}
