import { useMemo } from "react";
import { applyFilterSortSearch } from "../../lib/databaseQuery";
import type { CellValue, DatabasePanelState, DatabaseRowView } from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";
import { useOrganizationStore } from "../../store/organizationStore";
import { useTeamStore } from "../../store/teamStore";
import { useSchedulerProjectsStore } from "../../store/schedulerProjectsStore";
import { effectiveOptions, isCellValueDerived, resolveDerivedCellValue } from "../../lib/database/columnSource";
import { createDatabaseRowSourcesSelector } from "./databaseRowSources";

const EMPTY_ROW_PAGE_ORDER: readonly string[] = [];

export function useProcessedRows(
  databaseId: string,
  panelState: DatabasePanelState,
) {
  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const databases = useDatabaseStore((s) => s.databases);
  const organizations = useOrganizationStore((s) => s.organizations);
  const teams = useTeamStore((s) => s.teams);
  const projects = useSchedulerProjectsStore((s) => s.projects);
  const rowPageOrder = bundle?.rowPageOrder ?? EMPTY_ROW_PAGE_ORDER;
  const rowSourcesSelector = useMemo(
    () => createDatabaseRowSourcesSelector(rowPageOrder),
    [rowPageOrder],
  );
  const rowSources = usePageStore(rowSourcesSelector);
  const pages = usePageStore((s) => s.pages);

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
      for (const column of bundle.columns) {
        if (!isCellValueDerived(column)) continue;
        const derived = resolveDerivedCellValue(column, cells, pages, {
          currentRowPageId: source.pageId,
          databases,
        });
        cells[column.id] = (derived as CellValue) ?? null;
      }
      ordered.push({
        pageId: source.pageId,
        databaseId: source.databaseId || databaseId,
        title: source.title,
        icon: source.icon,
        cells,
      });
    }
    const queryColumns = bundle.columns.map((column) => {
      if (!["select", "multiSelect", "status"].includes(column.type)) return column;
      return {
        ...column,
        config: {
          ...(column.config ?? {}),
          options: effectiveOptions(column, databases, { organizations, teams, projects }),
        },
      };
    });
    const activePreset =
      (panelState.filterPresets ?? []).find((preset) => preset.id === panelState.activePresetId) ?? null;
    const effectiveFilterRules = activePreset?.filterRules ?? panelState.filterRules;
    // 구버전(sortRules 미존재 + sortColumnId 있음)은 첫 규칙으로 자동 마이그레이션.
    const effectiveSortRules =
      activePreset?.sortRules && activePreset.sortRules.length > 0
        ? activePreset.sortRules
        : panelState.sortRules && panelState.sortRules.length > 0
          ? panelState.sortRules
        : panelState.sortColumnId
          ? [{ columnId: panelState.sortColumnId, dir: panelState.sortDir }]
          : [];
    const rows = applyFilterSortSearch(
      ordered,
      queryColumns,
      panelState.searchQuery,
      effectiveFilterRules,
      effectiveSortRules,
    );
    return { rows, columns: bundle.columns };
  }, [bundle, databases, rowSources, databaseId, organizations, pages, panelState, projects, teams]);

  return { bundle, rows: processed.rows, columns: processed.columns };
}
