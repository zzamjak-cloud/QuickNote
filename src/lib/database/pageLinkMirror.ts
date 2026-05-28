import type { ColumnDef, DatabaseBundle } from "../../types/database";
import type { Page } from "../../types/page";

type ResolvePageLinkMirrorArgs = {
  databases: Record<string, DatabaseBundle>;
  pages: Record<string, Page>;
  currentDatabaseId?: string;
  rowId: string;
  column: ColumnDef;
};

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function resolvePageLinkMirrorValue({
  databases,
  pages,
  currentDatabaseId,
  rowId,
  column,
}: ResolvePageLinkMirrorArgs): string[] | undefined {
  if (column.type !== "pageLink") return undefined;
  const sourceDatabaseId = column.config?.pageLinkScopeDatabaseId;
  const mirrorColumnId = column.config?.pageLinkMirrorColumnId;
  if (!sourceDatabaseId || !mirrorColumnId) return undefined;

  const sourceDb = databases[sourceDatabaseId];
  if (!sourceDb) return [];
  const mirrorColumn = sourceDb.columns.find((c) => c.id === mirrorColumnId);
  if (mirrorColumn?.type !== "pageLink") return [];

  const pageLinkColumns = sourceDb.columns.filter(
    (c) => c.type === "pageLink" && c.id !== mirrorColumnId,
  );
  const scopedColumns = currentDatabaseId
    ? pageLinkColumns.filter((c) => c.config?.pageLinkScopeDatabaseId === currentDatabaseId)
    : [];
  const membershipColumns = scopedColumns.length > 0 ? scopedColumns : pageLinkColumns;
  const currentRowLinkedSourceIds = new Set<string>();
  const currentRowCells = pages[rowId]?.dbCells;
  if (currentRowCells) {
    for (const value of Object.values(currentRowCells)) {
      for (const linkedId of stringArrayValue(value)) {
        if (pages[linkedId]?.databaseId === sourceDatabaseId) {
          currentRowLinkedSourceIds.add(linkedId);
        }
      }
    }
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const sourcePageId of sourceDb.rowPageOrder) {
    const sourcePage = pages[sourcePageId];
    if (!sourcePage) continue;
    const matchedBySource = membershipColumns.some((membershipColumn) =>
      stringArrayValue(sourcePage.dbCells?.[membershipColumn.id]).includes(rowId),
    );
    if (!matchedBySource && !currentRowLinkedSourceIds.has(sourcePageId)) continue;

    for (const linkedPageId of stringArrayValue(sourcePage.dbCells?.[mirrorColumnId])) {
      if (seen.has(linkedPageId)) continue;
      seen.add(linkedPageId);
      result.push(linkedPageId);
    }
  }

  return result;
}
