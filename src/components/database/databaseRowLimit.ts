import type { DatabaseLayout } from "../../types/database";

export const DEFAULT_DATABASE_VISIBLE_ROW_LIMIT = 100;
export const MIN_DATABASE_INLINE_ROW_LIMIT = 10;

function normalizeInlineItemLimit(itemLimit: number | undefined): number | undefined {
  if (itemLimit == null) return undefined;
  return Math.max(itemLimit, MIN_DATABASE_INLINE_ROW_LIMIT);
}

export function resolveDatabaseInitialRowLimit(
  layout: DatabaseLayout,
  itemLimit: number | undefined,
): number {
  if (layout === "fullPage") return DEFAULT_DATABASE_VISIBLE_ROW_LIMIT;
  return normalizeInlineItemLimit(itemLimit) ?? DEFAULT_DATABASE_VISIBLE_ROW_LIMIT;
}

export function resolveDatabaseRefreshRowLimit(
  _layout: DatabaseLayout,
  _itemLimit: number | undefined,
): number {
  return DEFAULT_DATABASE_VISIBLE_ROW_LIMIT;
}

export function resolveDatabaseVisibleRowLimit(args: {
  layout: DatabaseLayout;
  itemLimit: number | undefined;
  totalRows: number;
  extraRows: number;
}): number | undefined {
  const defaultLimit = DEFAULT_DATABASE_VISIBLE_ROW_LIMIT;
  const explicitLimit =
    args.layout === "inline" ? normalizeInlineItemLimit(args.itemLimit) ?? null : null;
  if (explicitLimit != null) return explicitLimit + args.extraRows;
  if (args.totalRows < defaultLimit) return undefined;
  return defaultLimit + args.extraRows;
}
