import { useMemo } from "react";
import { applyFilterSortSearch } from "../../lib/databaseQuery";
import type { CellValue, DatabasePanelState, DatabaseRowView } from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";
import { createDatabaseRowSourcesSelector } from "./databaseRowSources";

const EMPTY_ROW_PAGE_ORDER: readonly string[] = [];

export function useProcessedRows(
  databaseId: string,
  panelState: DatabasePanelState,
) {
  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const rowPageOrder = bundle?.rowPageOrder ?? EMPTY_ROW_PAGE_ORDER;
  const rowSourcesSelector = useMemo(
    () => createDatabaseRowSourcesSelector(rowPageOrder),
    [rowPageOrder],
  );
  const rowSources = usePageStore(rowSourcesSelector);

  const processed = useMemo(() => {
    if (
      !bundle ||
      !Array.isArray(bundle.columns) ||
      !Array.isArray(bundle.rowPageOrder)
    ) {
      return { rows: [] as DatabaseRowView[], columns: [] };
    }
    const titleCol = bundle.columns.find((c) => c.type === "title");
    const ordered: DatabaseRowView[] = [];
    for (const source of rowSources) {
      const cells: Record<string, CellValue> = { ...(source.dbCells ?? {}) };
      if (titleCol) cells[titleCol.id] = source.title;
      ordered.push({
        pageId: source.pageId,
        databaseId: source.databaseId || databaseId,
        title: source.title,
        icon: source.icon,
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
  }, [bundle, rowSources, databaseId, panelState]);

  return { bundle, rows: processed.rows, columns: processed.columns };
}
