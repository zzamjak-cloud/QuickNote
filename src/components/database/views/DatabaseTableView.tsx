import { useState } from "react";
import { Plus, GripVertical, ArrowUpRight, PanelRight, X } from "lucide-react";
import type { DatabasePanelState } from "../../../types/database";
import { defaultMinWidthForType, getVisibleOrderedColumns } from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useProcessedRows } from "../useProcessedRows";
import { DatabaseCell } from "../DatabaseCell";
import { DatabaseColumnHeader } from "../DatabaseColumnHeader";
import { DatabaseAddColumnButton } from "../DatabaseAddColumnButton";
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

export function DatabaseTableView({ databaseId, panelState, setPanelState }: Props) {
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

  // 뷰별 가시·정렬 컬럼 (#9)
  const visibleCols = getVisibleOrderedColumns(
    bundle.columns,
    "table",
    panelState.viewConfigs,
  );

  // moveColumn은 bundle.columns 기준 인덱스를 받으므로 visibleCols 인덱스를 변환.
  const colIdToBundleIdx = new Map(
    bundle.columns.map((c, i) => [c.id, i]),
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
    setColDragFrom(null);
    setColDragOver(null);
  };

  const onRowDrop = () => {
    if (rowDragFrom != null && rowDragOver != null && rowDragFrom !== rowDragOver) {
      const order = [...bundle.rowPageOrder];
      const [m] = order.splice(rowDragFrom, 1);
      if (m) order.splice(rowDragOver, 0, m);
      setRowOrder(databaseId, order);
    }
    setRowDragFrom(null);
    setRowDragOver(null);
  };

  const openFull = (pageId: string) => {
    setActivePage(pageId);
    setCurrentTabPage(pageId);
  };

  return (
    // 헤더 sticky를 위해 wrapper에 max-h + overflow-y-auto. 가로 스크롤도 동일 wrapper.
    <div className="max-h-[60vh] overflow-x-auto overflow-y-auto">
      <table className="w-full border-collapse text-left text-xs" style={{ tableLayout: "fixed" }}>
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
          {/* + 버튼 + 설정 버튼 컬럼 (각 32px) */}
          <col style={{ width: 32, minWidth: 32 }} />
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
                  colDragFrom != null && colDragOver === idx && colDragFrom !== idx
                    ? colDragFrom < idx ? "right" : "left"
                    : null
                }
              />
            ))}
            <DatabaseAddColumnButton databaseId={databaseId} />
            <DatabaseColumnSettingsButton
              databaseId={databaseId}
              viewKind="table"
              panelState={panelState}
              setPanelState={setPanelState}
              asTh
            />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rIdx) => {
            const isDropTarget = rowDragFrom != null && rowDragOver === rIdx && rowDragFrom !== rIdx;
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
                ].join(" ")}
              >
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
                          <DatabaseCell
                            databaseId={databaseId}
                            rowId={row.pageId}
                            column={col}
                            value={row.title}
                          />
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
                              if (window.confirm("이 행을 삭제할까요? (연결된 페이지도 삭제됩니다)")) {
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
                {/* "+" 헤더, 설정 헤더와 cell 수 일치 */}
                <td />
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
