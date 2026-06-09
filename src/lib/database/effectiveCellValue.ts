import type { CellValue, ColumnDef, DatabaseBundle } from "../../types/database";
import type { Page } from "../../types/page";
import {
  isCellValueDerived,
  resolveDerivedCellValue,
  resolveItemFetchPageIds,
  shouldUseManualCellValueForAutomation,
} from "./columnSource";
import { resolvePageLinkMirrorValue } from "./pageLinkMirror";

type ResolveEffectiveCellValueArgs = {
  column: ColumnDef;
  rowPageId?: string | null;
  currentDatabaseId?: string | null;
  rawValue?: CellValue;
  rowCells?: Record<string, unknown>;
  databases: Record<string, DatabaseBundle>;
  pages: Record<string, Page>;
};

export function resolveEffectiveCellValue({
  column,
  rowPageId,
  currentDatabaseId,
  rawValue,
  rowCells,
  databases,
  pages,
}: ResolveEffectiveCellValueArgs): CellValue {
  const cells = rowCells ?? (rowPageId ? pages[rowPageId]?.dbCells : undefined);
  const raw = rawValue ?? (cells?.[column.id] as CellValue);
  if (!rowPageId) return raw;

  if (isCellValueDerived(column)) {
    const derived = resolveDerivedCellValue(column, cells, pages, {
      currentRowPageId: rowPageId,
      databases,
    });
    if (!shouldUseManualCellValueForAutomation(column, derived)) {
      return (derived as CellValue | undefined) ?? raw;
    }
  }

  if (column.type === "pageLink") {
    return resolvePageLinkMirrorValue({
      databases,
      pages,
      currentDatabaseId: currentDatabaseId ?? undefined,
      rowId: rowPageId,
      column,
    }) ?? raw;
  }

  if (column.type === "itemFetch") {
    return resolveItemFetchPageIds(column, rowPageId, databases, pages);
  }

  return raw;
}

export function resolveEffectiveCellValueById(args: {
  databaseId: string;
  columnId: string;
  rowPageId: string;
  databases: Record<string, DatabaseBundle>;
  pages: Record<string, Page>;
}): CellValue {
  const column = args.databases[args.databaseId]?.columns.find((candidate) => candidate.id === args.columnId);
  if (!column) return args.pages[args.rowPageId]?.dbCells?.[args.columnId] as CellValue;
  return resolveEffectiveCellValue({
    column,
    rowPageId: args.rowPageId,
    currentDatabaseId: args.databaseId,
    databases: args.databases,
    pages: args.pages,
  });
}
