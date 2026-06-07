import type { DatabaseLayout } from "../../types/database";

export const DEFAULT_DATABASE_VISIBLE_ROW_LIMIT = 100;

export function resolveDatabaseInitialRowLimit(
  layout: DatabaseLayout,
  itemLimit: number | undefined,
): number {
  return layout === "inline"
    ? itemLimit ?? DEFAULT_DATABASE_VISIBLE_ROW_LIMIT
    : DEFAULT_DATABASE_VISIBLE_ROW_LIMIT;
}

export function resolveDatabaseVisibleRowLimit(args: {
  layout: DatabaseLayout;
  itemLimit: number | undefined;
  totalRows: number;
  extraRows: number;
}): number | undefined {
  const defaultLimit = DEFAULT_DATABASE_VISIBLE_ROW_LIMIT;
  const explicitLimit = args.layout === "inline" ? args.itemLimit ?? null : null;
  if (explicitLimit != null) return explicitLimit + args.extraRows;
  if (args.totalRows < defaultLimit) return undefined;
  return defaultLimit + args.extraRows;
}
