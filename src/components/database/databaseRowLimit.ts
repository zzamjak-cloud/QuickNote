import type { DatabaseLayout } from "../../types/database";

export const DEFAULT_DATABASE_VISIBLE_ROW_LIMIT = 100;

export function resolveDatabaseInitialRowLimit(
  _layout: DatabaseLayout,
  itemLimit: number | undefined,
): number {
  return itemLimit ?? DEFAULT_DATABASE_VISIBLE_ROW_LIMIT;
}

export function resolveDatabaseVisibleRowLimit(args: {
  layout: DatabaseLayout;
  itemLimit: number | undefined;
  totalRows: number;
  extraRows: number;
}): number | undefined {
  const defaultLimit = DEFAULT_DATABASE_VISIBLE_ROW_LIMIT;
  const explicitLimit = args.itemLimit ?? null;
  if (explicitLimit != null) return explicitLimit + args.extraRows;
  if (args.totalRows < defaultLimit) return undefined;
  return defaultLimit + args.extraRows;
}
