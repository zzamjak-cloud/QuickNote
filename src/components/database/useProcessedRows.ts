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
    // 구버전(sortRules 미존재 + sortColumnId 있음)은 첫 규칙으로 자동 마이그레이션.
    const effectiveSortRules =
      panelState.sortRules && panelState.sortRules.length > 0
        ? panelState.sortRules
        : panelState.sortColumnId
          ? [{ columnId: panelState.sortColumnId, dir: panelState.sortDir }]
          : [];
    const rows = applyFilterSortSearch(
      ordered,
      bundle.columns,
      panelState.searchQuery,
      panelState.filterRules,
      effectiveSortRules,
    );
    return { rows, columns: bundle.columns };
  }, [bundle, pages, databaseId, panelState]);

  return { bundle, rows: processed.rows, columns: processed.columns };
}
