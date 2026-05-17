import { getVisibleOrderedColumns } from "../../../types/database";
import type { DatabasePanelState } from "../../../types/database";
import { summarizeJsonValue } from "../../../lib/database/jsonCell";
import { useProcessedRows } from "../useProcessedRows";
import { usePageStore } from "../../../store/pageStore";
import { useUiStore } from "../../../store/uiStore";
import { IconPicker } from "../../common/IconPicker";
import { useWindowedRows } from "./useWindowedRows";

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
  const listCfg = panelState.viewConfigs?.list;

  // 명시적으로 visibleColumnIds가 설정되어 있으면 그것을 사용, 없으면 타이틀만 표시
  const extraCols = listCfg?.visibleColumnIds && listCfg.visibleColumnIds.length > 0
    ? getVisibleOrderedColumns(columns, "list", panelState.viewConfigs).filter(
        (c) => c.id !== titleCol?.id,
      )
    : [];

  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-zinc-400">항목이 없습니다.</p>
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
                size="sm"
                onChange={(icon) => setIcon(row.pageId, icon)}
              />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">
              {title}
            </span>
            {extraCols.map((col) => {
              const cell = row.cells[col.id];
              let display = "";
              if (cell != null) {
                if (col.type === "json") display = summarizeJsonValue(cell);
                else if (Array.isArray(cell)) display = (cell as string[]).join(", ");
                else display = String(cell);
              }
              if (!display) return null;
              return (
                <span
                  key={col.id}
                  className="shrink-0 truncate text-xs text-zinc-400 dark:text-zinc-500"
                >
                  {display}
                </span>
              );
            })}
          </div>
        );
      })}
      {virtualRows.bottomPadding > 0 && (
        <div aria-hidden="true" style={{ height: virtualRows.bottomPadding }} />
      )}
    </div>
  );
}
