import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { applyFilterSortSearch, resolveActiveFilterRules } from "../../lib/databaseQuery";
import type { CellValue, DatabasePanelState, DatabaseRowView } from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";
import { useOrganizationStore } from "../../store/organizationStore";
import { useTeamStore } from "../../store/teamStore";
import { useSchedulerProjectsStore } from "../../store/schedulerProjectsStore";
import { useMemberStore } from "../../store/memberStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useDatabaseRowIndexStore } from "../../store/databaseRowIndexStore";
import type { DatabaseRowIndexEntry } from "../../lib/database/databaseRowIndexCache";
import {
  isCellValueDerived,
  resolveDerivedCellValue,
  shouldUseManualCellValueForAutomation,
} from "../../lib/database/columnSource";
import { resolveDatabaseRowRemoteKey } from "../../lib/sync/externalProtectedDatabaseLoad";
import {
  resolveFilterableCellValue,
  withFilterDisplayOptions,
} from "../../lib/database/filterValueLabels";
import { createDatabaseRowSourcesSelector } from "./databaseRowSources";
import {
  collectDatabaseDependencyIds,
  collectPageDependencyIds,
} from "./databaseQueryDependencies";
import {
  createDatabaseDependencyMapSelector,
  createPageDependencyMapSelector,
} from "./renderScopeSelectors";

const EMPTY_ROW_PAGE_ORDER: readonly string[] = [];
const EMPTY_ROW_INDEX_ROWS: readonly DatabaseRowIndexEntry[] = [];

export function useProcessedRows(
  databaseId: string,
  panelState: DatabasePanelState,
) {
  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const organizations = useOrganizationStore((s) => s.organizations);
  const teams = useTeamStore((s) => s.teams);
  const projects = useSchedulerProjectsStore((s) => s.projects);
  const members = useMemberStore((s) => s.members);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const rowIndexKey = useMemo(
    () => resolveDatabaseRowRemoteKey(databaseId, currentWorkspaceId),
    [currentWorkspaceId, databaseId],
  );
  const hydrateRowIndex = useDatabaseRowIndexStore((s) => s.hydrateIndex);
  useEffect(() => {
    if (!rowIndexKey) return;
    void hydrateRowIndex(rowIndexKey);
  }, [hydrateRowIndex, rowIndexKey]);
  const rowIndexRows = useDatabaseRowIndexStore(
    (s) =>
      rowIndexKey
        ? (s.snapshotsByKey[rowIndexKey]?.rows ?? EMPTY_ROW_INDEX_ROWS)
        : EMPTY_ROW_INDEX_ROWS,
  );
  const bundleRowPageOrder = bundle?.rowPageOrder ?? EMPTY_ROW_PAGE_ORDER;
  const rowPageOrder = useMemo(() => {
    if (rowIndexRows.length === 0) return bundleRowPageOrder;
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const row of rowIndexRows) {
      if (seen.has(row.pageId)) continue;
      seen.add(row.pageId);
      ids.push(row.pageId);
    }
    for (const pageId of bundleRowPageOrder) {
      if (seen.has(pageId)) continue;
      seen.add(pageId);
      ids.push(pageId);
    }
    return ids;
  }, [bundleRowPageOrder, rowIndexRows]);
  const rowSourcesSelector = useMemo(
    () => createDatabaseRowSourcesSelector(rowPageOrder, rowIndexRows),
    [rowIndexRows, rowPageOrder],
  );
  const rowSources = usePageStore(rowSourcesSelector);
  const databaseDependencyIds = useMemo(
    () => collectDatabaseDependencyIds(databaseId, bundle?.columns ?? [], rowSources),
    [databaseId, bundle?.columns, rowSources],
  );
  const databaseDependenciesSelector = useMemo(
    () => createDatabaseDependencyMapSelector(databaseDependencyIds),
    [databaseDependencyIds],
  );
  const databases = useDatabaseStore(useShallow(databaseDependenciesSelector));
  const pageDependencyIds = useMemo(
    () => collectPageDependencyIds(rowSources, bundle?.columns ?? [], databases),
    [rowSources, bundle?.columns, databases],
  );
  const pageDependenciesSelector = useMemo(
    () => createPageDependencyMapSelector(pageDependencyIds),
    [pageDependencyIds],
  );
  const pages = usePageStore(useShallow(pageDependenciesSelector));
  const queryState = useMemo(() => {
    const activePreset =
      (panelState.filterPresets ?? []).find(
        (preset) => preset.id === panelState.activePresetId,
      ) ?? null;
    const effectiveFilterRules = resolveActiveFilterRules(panelState);
    const effectiveSortRules =
      activePreset?.sortRules && activePreset.sortRules.length > 0
        ? activePreset.sortRules
        : panelState.sortRules && panelState.sortRules.length > 0
          ? panelState.sortRules
          : panelState.sortColumnId
            ? [{ columnId: panelState.sortColumnId, dir: panelState.sortDir }]
            : [];
    return {
      searchQuery: panelState.searchQuery,
      filterRules: effectiveFilterRules,
      sortRules: effectiveSortRules,
    };
  }, [
    panelState.activePresetId,
    panelState.filterPresets,
    panelState.filterRules,
    panelState.searchQuery,
    panelState.sortColumnId,
    panelState.sortDir,
    panelState.sortRules,
  ]);

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
        if (column.type === "title") continue;
        if (!isCellValueDerived(column)) continue;
        const derived = resolveDerivedCellValue(column, cells, pages, {
          currentRowPageId: source.pageId,
          databases,
        });
        if (!shouldUseManualCellValueForAutomation(column, derived)) {
          cells[column.id] = (derived as CellValue) ?? null;
        }
      }
      for (const column of bundle.columns) {
        if (column.type === "title") continue;
        cells[column.id] = resolveFilterableCellValue({
          column,
          rowPageId: source.pageId,
          currentDatabaseId: source.databaseId || databaseId,
          rawValue: cells[column.id],
          pages,
          databases,
        });
      }
      ordered.push({
        pageId: source.pageId,
        databaseId: source.databaseId || databaseId,
        title: source.title,
        icon: source.icon,
        cells,
      });
    }
    const queryColumns = withFilterDisplayOptions(bundle.columns, {
      databases,
      pages,
      members,
      scopeCtx: { organizations, teams, projects },
    });
    const rows = applyFilterSortSearch(
      ordered,
      queryColumns,
      queryState.searchQuery,
      queryState.filterRules,
      queryState.sortRules,
    );
    return { rows, columns: bundle.columns };
  }, [bundle, databases, rowSources, databaseId, members, organizations, pages, queryState, projects, teams]);

  return { bundle, rows: processed.rows, columns: processed.columns };
}
