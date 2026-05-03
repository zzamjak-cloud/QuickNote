import { useMemo } from "react";
import { applyFilterSortSearch } from "../../lib/databaseQuery";
import type { CellValue, DatabasePanelState, DatabaseRowView } from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";

export function useProcessedRows(
  databaseId: string,
  panelState: DatabasePanelState,
) {
  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const pages = usePageStore((s) => s.pages);

  const processed = useMemo(() => {
    if (!bundle) return { rows: [] as DatabaseRowView[], columns: [] };
    const titleCol = bundle.columns.find((c) => c.type === "title");
    const ordered: DatabaseRowView[] = [];
    for (const pageId of bundle.rowPageOrder ?? []) {
      const page = pages[pageId];
      if (!page) continue;
      const cells: Record<string, CellValue> = { ...(page.dbCells ?? {}) };
      if (titleCol) cells[titleCol.id] = page.title;
      ordered.push({
        pageId,
        databaseId,
        title: page.title,
        cells,
      });
    }
    const rows = applyFilterSortSearch(
      ordered,
      bundle.columns,
      panelState.searchQuery,
      panelState.filterRules,
      panelState.sortColumnId,
      panelState.sortDir,
    );
    return { rows, columns: bundle.columns };
  }, [bundle, pages, databaseId, panelState]);

  return { bundle, rows: processed.rows, columns: processed.columns };
}
