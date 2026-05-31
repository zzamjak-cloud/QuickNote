import type { CellValue } from "../../types/database";
import type { Page } from "../../types/page";
import { LC_FEATURE_COLUMN_IDS } from "./featureDatabase";
import { LC_MILESTONE_COLUMN_IDS } from "./milestoneDatabase";

type SchedulerDatabaseMode = "milestone" | "feature";
type SchedulerScopeColumnIds = {
  organization: string;
  team: string;
  project: string;
};

export function schedulerCellHasId(value: CellValue, id: string): boolean {
  if (Array.isArray(value)) return value.some((item) => item === id);
  if (typeof value === "string") return value === id;
  if (typeof value === "number") return String(value) === id;
  return false;
}

export function schedulerPageLinkIds(value: CellValue): string[] {
  if (Array.isArray(value)) {
    const ids: string[] = [];
    for (const item of value) {
      if (typeof item === "string") ids.push(item);
    }
    return ids;
  }
  return typeof value === "string" && value ? [value] : [];
}

export function schedulerPageLinkIncludes(value: CellValue, ids: Set<string>): boolean {
  return schedulerPageLinkIds(value).some((id) => ids.has(id));
}

function matchesScopeColumns(
  cells: Record<string, CellValue>,
  columnIds: SchedulerScopeColumnIds,
  selectedScopeId: string | null,
): boolean {
  if (!selectedScopeId) return true;
  if (selectedScopeId.startsWith("org:")) {
    return schedulerCellHasId(cells[columnIds.organization], selectedScopeId.slice(4));
  }
  if (selectedScopeId.startsWith("team:")) {
    return schedulerCellHasId(cells[columnIds.team], selectedScopeId.slice(5));
  }
  if (selectedScopeId.startsWith("proj:")) {
    return schedulerCellHasId(cells[columnIds.project], selectedScopeId.slice(5));
  }
  return true;
}

export function matchesSchedulerScope(
  page: Page,
  mode: SchedulerDatabaseMode,
  selectedScopeId: string | null,
  pages?: Record<string, Page>,
): boolean {
  if (!selectedScopeId) return true;
  const cells = page.dbCells ?? {};
  if (mode === "feature" && pages) {
    const milestonePageIds = schedulerPageLinkIds(cells[LC_FEATURE_COLUMN_IDS.milestone]);
    if (milestonePageIds.length > 0) {
      return milestonePageIds.some((milestonePageId) => {
        const milestonePage = pages[milestonePageId];
        if (!milestonePage || milestonePage.dbCells?._qn_isTemplate === "1") return false;
        return matchesScopeColumns(milestonePage.dbCells ?? {}, LC_MILESTONE_COLUMN_IDS, selectedScopeId);
      });
    }
  }

  const columnIds = mode === "milestone" ? LC_MILESTONE_COLUMN_IDS : LC_FEATURE_COLUMN_IDS;
  return matchesScopeColumns(cells, columnIds, selectedScopeId);
}

export function getScopedMilestoneIds(
  rowPageOrder: string[],
  pages: Record<string, Page>,
  selectedScopeId: string | null,
): Set<string> {
  const ids = new Set<string>();
  for (const pageId of rowPageOrder) {
    const page = pages[pageId];
    if (!page || page.dbCells?._qn_isTemplate === "1") continue;
    if (matchesSchedulerScope(page, "milestone", selectedScopeId, pages)) ids.add(page.id);
  }
  return ids;
}
