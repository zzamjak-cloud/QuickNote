import { useState } from "react";
import { Plus, GripVertical, ArrowUpRight, PanelRight, X } from "lucide-react";
import type { DatabasePanelState } from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useProcessedRows } from "../useProcessedRows";
import { DatabaseCell } from "../DatabaseCell";
import { DatabaseColumnHeader } from "../DatabaseColumnHeader";
import { DatabaseAddColumnButton } from "../DatabaseAddColumnButton";
import { usePageStore } from "../../../store/pageStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { useUiStore } from "../../../store/uiStore";

type Props = {
  databaseId: string;
  panelState: DatabasePanelState;
  setPanelState: (p: Partial<DatabasePanelState>) => void;
};

const DRAG_MIME = "application/x-quicknote-db-drag";

export function DatabaseTableView({ databaseId, panelState }: Props) {
  const { bundle, rows, columns } = useProcessedRows(databaseId, panelState);
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

  const onColDrop = () => {
    if (colDragFrom != null && colDragOver != null && colDragFrom !== colDragOver) {
      moveColumn(databaseId, colDragFrom, colDragOver);
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
    <div className="inline-block min-w-full align-middle">
      <table className="w-full border-collapse text-left text-xs" style={{ tableLayout: "fixed" }}>
        <colgroup>
          {columns.map((col) => (
            <col key={col.id} style={col.width ? { width: col.width } : undefined} />
          ))}
          <col style={{ width: 32 }} />
        </colgroup>
        <thead>
          <tr>
            {columns.map((col, idx) => (
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
                  isDropTarget ? "border-t-2 border-t-blue-500" : "",
                ].join(" ")}
              >
                {columns.map((col, cIdx) => {
                  const isFirst = cIdx === 0;
                  return (
                    <td
                      key={col.id}
                      className={[
                        "align-top px-2 py-1",
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
                {/* "+" 헤더 컬럼과 cell 수 일치를 위한 빈 td */}
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
