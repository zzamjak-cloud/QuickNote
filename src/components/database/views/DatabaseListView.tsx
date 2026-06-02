import { Plus } from "lucide-react";
import { getVisibleOrderedColumns } from "../../../types/database";
import type { DatabasePanelState } from "../../../types/database";
import { useProcessedRows } from "../useProcessedRows";
import { usePageStore } from "../../../store/pageStore";
import { useUiStore } from "../../../store/uiStore";
import { useDatabaseStore } from "../../../store/databaseStore";
import { resolveActiveFilterRules } from "../../../lib/databaseQuery";
import { IconPicker } from "../../common/IconPicker";
import { useWindowedRows } from "./useWindowedRows";
import {
  DatabaseCellDisplay,
} from "../DatabaseCellDisplay";
import {
  databaseCellHasDisplayValue,
  databaseColumnMayHaveDerivedDisplayValue,
} from "../databaseCellDisplayUtils";

type Props = {
  databaseId: string;
  panelState: DatabasePanelState;
  setPanelState: (p: Partial<DatabasePanelState>) => void;
  visibleRowLimit?: number;
};

export function DatabaseListView({ databaseId, panelState, visibleRowLimit }: Props) {
  const { bundle, rows: allRows, columns } = useProcessedRows(databaseId, panelState);
  const rows = visibleRowLimit != null ? allRows.slice(0, visibleRowLimit) : allRows;

  const setIcon = usePageStore((s) => s.setIcon);
  const openPeek = useUiStore((s) => s.openPeek);
  const addRow = useDatabaseStore((s) => s.addRow);
  const virtualRows = useWindowedRows({
    count: rows.length,
    estimateSize: 34,
    enabled: visibleRowLimit == null && rows.length > 160,
    overscan: 12,
  });
  const renderedRows = virtualRows.enabled
    ? rows.slice(virtualRows.start, virtualRows.end)
    : rows;

  if (!bundle) return null;

  const titleCol = columns.find((c) => c.type === "title");

  // 모든 뷰 공통 규칙 — getVisibleOrderedColumns 결과(설정 없으면 전체 표시)에서 제목만 분리.
  const extraCols = getVisibleOrderedColumns(columns, "list", panelState.viewConfigs).filter(
    (c) => c.id !== titleCol?.id,
  );

  if (rows.length === 0) {
    return (
      <div className="pt-2">
        <p className="py-6 text-center text-xs text-zinc-400">항목이 없습니다.</p>
        <button
          type="button"
          onClick={() => addRow(databaseId, resolveActiveFilterRules(panelState))}
          className="mt-2 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <Plus size={14} /> 새 항목
        </button>
      </div>
    );
  }

  return (
    <div ref={virtualRows.containerRef} className="pt-2">
      {virtualRows.topPadding > 0 && (
        <div aria-hidden="true" style={{ height: virtualRows.topPadding }} />
      )}
      {renderedRows.map((row) => {
        const title = row.title || "제목 없음";

        return (
          <div
            key={row.pageId}
            onClick={() => openPeek(row.pageId)}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
          >
            <span
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <IconPicker
                current={row.icon ?? null}
                size="md"
                onChange={(icon) => setIcon(row.pageId, icon)}
              />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">
              {title}
            </span>
            {extraCols.map((col) => {
              const cell = row.cells[col.id];
              if (!databaseCellHasDisplayValue(cell, col) && !databaseColumnMayHaveDerivedDisplayValue(col)) return null;
              return (
                <span
                  key={col.id}
                  className="shrink-0 truncate text-sm"
                >
                  <DatabaseCellDisplay column={col} value={cell} rowId={row.pageId} />
                </span>
              );
            })}
          </div>
        );
      })}
      {virtualRows.bottomPadding > 0 && (
        <div aria-hidden="true" style={{ height: virtualRows.bottomPadding }} />
      )}
      <button
        type="button"
        onClick={() => addRow(databaseId, resolveActiveFilterRules(panelState))}
        className="mt-2 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        <Plus size={14} /> 새 항목
      </button>
    </div>
  );
}
