import type { CellValue, ColumnDef, DatabaseBundle } from "../../types/database";

export type DatabaseDependencyMap = Record<string, DatabaseBundle>;

export type DatabaseDependencyRow = {
  dbCells?: Record<string, CellValue>;
  cells?: Record<string, CellValue>;
};

export type PageDependencyRow = {
  pageId: string;
  dbCells?: Record<string, CellValue>;
  cells?: Record<string, CellValue>;
};

function addId(ids: Set<string>, value: unknown) {
  if (typeof value !== "string") return;
  const id = value.trim();
  if (id) ids.add(id);
}

function addStringArrayIds(ids: Set<string>, value: unknown) {
  if (!Array.isArray(value)) return;
  for (const item of value) addId(ids, item);
}

function pageLinkLikeColumnIds(columns: readonly ColumnDef[]): Set<string> {
  return new Set(
    columns
      .filter((column) => column.type === "pageLink" || column.type === "itemFetch")
      .map((column) => column.id),
  );
}

export function collectDatabaseDependencyIds(
  currentDatabaseId: string | null | undefined,
  columns: readonly ColumnDef[],
  rows: readonly DatabaseDependencyRow[] = [],
): string[] {
  const ids = new Set<string>();
  addId(ids, currentDatabaseId);
  const dbLinkColumns = new Set(
    columns.filter((column) => column.type === "dbLink").map((column) => column.id),
  );

  for (const column of columns) {
    addId(ids, column.config?.pageLinkScopeDatabaseId);
    addId(ids, column.config?.itemFetchSourceDatabaseId);
    addId(ids, column.config?.sourceFromDb?.databaseId);
  }

  for (const row of rows) {
    const cells = row.dbCells ?? row.cells ?? {};
    for (const [columnId, value] of Object.entries(cells)) {
      if (!dbLinkColumns.has(columnId)) continue;
      addId(ids, value);
      addStringArrayIds(ids, value);
    }
  }

  return Array.from(ids).sort();
}

export function collectPageDependencyIds(
  rows: readonly PageDependencyRow[],
  columns: readonly ColumnDef[],
  databases: Record<string, Pick<DatabaseBundle, "rowPageOrder"> | undefined> = {},
): string[] {
  const ids = new Set<string>();
  const pageLikeColumns = pageLinkLikeColumnIds(columns);

  for (const database of Object.values(databases)) {
    for (const pageId of database?.rowPageOrder ?? []) addId(ids, pageId);
  }

  for (const row of rows) {
    addId(ids, row.pageId);
    const cells = row.dbCells ?? row.cells ?? {};
    for (const [columnId, value] of Object.entries(cells)) {
      if (!pageLikeColumns.has(columnId)) continue;
      addStringArrayIds(ids, value);
    }
  }

  return Array.from(ids).sort();
}
