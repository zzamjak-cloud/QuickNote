import type {
  CellValue,
  ColumnDef,
  DatabaseRowView,
  FilterOperator,
  FilterRule,
} from "../types/database";

export function cellToSearchString(
  value: CellValue,
  columns: ColumnDef[],
  columnId: string,
): string {
  if (value === null || value === undefined) return "";
  const col = columns.find((c) => c.id === columnId);
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "예" : "아니오";
  if (Array.isArray(value)) {
    if (value.length > 0 && typeof value[0] === "object" && value[0] !== null && "fileId" in value[0]) {
      return (value as { name?: string }[]).map((f) => f.name ?? "").join(" ");
    }
    const ids = value as string[];
    const opts = col?.config?.options ?? [];
    return ids
      .map((id) => opts.find((o) => o.id === id)?.label ?? id)
      .join(" ");
  }
  if (typeof value === "object" && "start" in (value as object)) {
    const d = value as { start?: string; end?: string };
    return [d.start, d.end].filter(Boolean).join(" ");
  }
  return String(value);
}

export function rowMatchesSearch(
  row: DatabaseRowView,
  columns: ColumnDef[],
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  for (const col of columns) {
    const s = cellToSearchString(row.cells[col.id], columns, col.id).toLowerCase();
    if (s.includes(q)) return true;
  }
  return false;
}

function compareCell(
  a: CellValue,
  b: CellValue,
  col: ColumnDef | undefined,
): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (col?.type === "number") {
    const na = typeof a === "number" ? a : Number(a);
    const nb = typeof b === "number" ? b : Number(b);
    return (Number.isFinite(na) ? na : 0) - (Number.isFinite(nb) ? nb : 0);
  }
  const sa = cellToSearchString(a, col ? [col] : [], col?.id ?? "");
  const sb = cellToSearchString(b, col ? [col] : [], col?.id ?? "");
  return sa.localeCompare(sb, "ko");
}

export function sortRows(
  rows: DatabaseRowView[],
  columnId: string | null,
  dir: "asc" | "desc",
  columns: ColumnDef[],
): DatabaseRowView[] {
  if (!columnId) return [...rows];
  const col = columns.find((c) => c.id === columnId);
  const sorted = [...rows].sort((r1, r2) =>
    compareCell(r1.cells[columnId], r2.cells[columnId], col),
  );
  return dir === "desc" ? sorted.reverse() : sorted;
}

function matchesFilter(
  row: DatabaseRowView,
  rule: FilterRule,
  columns: ColumnDef[],
): boolean {
  const raw = row.cells[rule.columnId];
  const col = columns.find((c) => c.id === rule.columnId);
  const str = cellToSearchString(raw, columns, rule.columnId);
  const empty = str.trim() === "";

  switch (rule.operator) {
    case "isEmpty":
      return empty;
    case "isNotEmpty":
      return !empty;
    case "contains":
      return str.toLowerCase().includes((rule.value ?? "").toLowerCase());
    case "equals":
      return str === (rule.value ?? "");
    case "notEquals":
      return str !== (rule.value ?? "");
    case "gt":
      if (col?.type === "number") {
        const n = typeof raw === "number" ? raw : Number(raw);
        const t = Number(rule.value);
        return Number.isFinite(n) && Number.isFinite(t) && n > t;
      }
      return str > (rule.value ?? "");
    case "lt":
      if (col?.type === "number") {
        const n = typeof raw === "number" ? raw : Number(raw);
        const t = Number(rule.value);
        return Number.isFinite(n) && Number.isFinite(t) && n < t;
      }
      return str < (rule.value ?? "");
    default:
      return true;
  }
}

export function applyFilters(
  rows: DatabaseRowView[],
  rules: FilterRule[],
  columns: ColumnDef[],
): DatabaseRowView[] {
  if (rules.length === 0) return rows;
  return rows.filter((row) =>
    rules.every((rule) => matchesFilter(row, rule, columns)),
  );
}

export function applyFilterSortSearch(
  rowsOrdered: DatabaseRowView[],
  columns: ColumnDef[],
  searchQuery: string,
  filterRules: FilterRule[],
  sortColumnId: string | null,
  sortDir: "asc" | "desc",
): DatabaseRowView[] {
  const searched = rowsOrdered.filter((r) =>
    rowMatchesSearch(r, columns, searchQuery),
  );
  const filtered = applyFilters(searched, filterRules, columns);
  return sortRows(filtered, sortColumnId, sortDir, columns);
}

export const FILTER_OPERATORS: { id: FilterOperator; label: string }[] = [
  { id: "contains", label: "포함" },
  { id: "equals", label: "같음" },
  { id: "notEquals", label: "다름" },
  { id: "gt", label: "보다 큼" },
  { id: "lt", label: "보다 작음" },
  { id: "isEmpty", label: "비어 있음" },
  { id: "isNotEmpty", label: "비어 있지 않음" },
];
