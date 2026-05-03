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
const ACTION_COL_WIDTH = 36;

/**
 * 리스트 뷰 — 표 뷰처럼 상단 컬럼 헤더를 한 줄 공유하고,
 * 본문은 행마다 1라인 그리드로 정렬해 표시한다.
 * - viewConfigs.list가 있으면 그 가시·순서를 따르고, 없으면 bundle.columns 전체.
 * - 컬럼 폭은 col.width ?? defaultMinWidthForType(col.type).
 * - 첫 컬럼(title)에 grip + open/peek/delete 액션 hover 오버레이.
 */
export function DatabaseListView({
  databaseId,
  panelState,
  setPanelState,
}: Props) {
  const { bundle, rows } = useProcessedRows(databaseId, panelState);
  const addRow = useDatabaseStore((s) => s.addRow);
  const deleteRow = useDatabaseStore((s) => s.deleteRow);
  const setRowOrder = useDatabaseStore((s) => s.setRowOrder);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const openPeek = useUiStore((s) => s.openPeek);

  const [rowDragFrom, setRowDragFrom] = useState<number | null>(null);
  const [rowDragOver, setRowDragOver] = useState<number | null>(null);

  if (!bundle) return null;

  const visibleCols = getVisibleOrderedColumns(
    bundle.columns,
    "list",
    panelState.viewConfigs,
  );

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

  // 그리드 컬럼 템플릿: 가시 컬럼 폭 + 우측 액션 영역.
  const gridTemplate =
    visibleCols
      .map((c) => `${c.width ?? defaultMinWidthForType(c.type)}px`)
      .join(" ") + ` ${ACTION_COL_WIDTH}px`;

  return (
    <div>
      <div className="mb-1 flex items-center justify-end">
        <DatabaseColumnSettingsButton
          databaseId={databaseId}
          viewKind="list"
          panelState={panelState}
          setPanelState={setPanelState}
        />
      </div>
      <div className="overflow-x-auto">
        <div className="inline-block min-w-full text-xs">
          {/* 헤더 */}
          <div
            className="grid border-b border-zinc-200 px-2 py-1.5 text-[11px] font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            {visibleCols.map((col) => (
              <div key={col.id} className="truncate pr-2">
                {col.name}
              </div>
            ))}
            <div />
          </div>
          {/* 본문: 행마다 1라인 그리드 */}
          <ul>
            {rows.map((row, rIdx) => {
              const isDropTarget =
                rowDragFrom != null &&
                rowDragOver === rIdx &&
                rowDragFrom !== rIdx;
              return (
                <li
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
                    "group relative grid items-center border-b border-zinc-100 px-2 py-1 dark:border-zinc-800",
                    isDropTarget
                      ? "border-t-2 border-dashed border-t-blue-400"
                      : "",
                  ].join(" ")}
                  style={{ gridTemplateColumns: gridTemplate }}
                >
                  {visibleCols.map((col, cIdx) => {
                    const isFirst = cIdx === 0;
                    const value =
                      col.type === "title" ? row.title : row.cells[col.id];
                    return (
                      <div
                        key={col.id}
                        className={[
                          "min-w-0 max-w-full truncate pr-2",
                          isFirst ? "relative" : "",
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
                            <GripVertical
                              size={12}
                              className="text-zinc-400"
                            />
                          </span>
                        )}
                        <DatabaseCell
                          databaseId={databaseId}
                          rowId={row.pageId}
                          column={col}
                          value={value}
                        />
                      </div>
                    );
                  })}
                  {/* 액션 영역 */}
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
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
                </li>
              );
            })}
          </ul>
        </div>
      </div>
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
