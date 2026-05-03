import type {
  CellValue,
  ColumnDef,
  DatabaseRowView,
  FilterOperator,
  FilterRule,
  SortRule,
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

/**
 * 행 검색.
 * - row.title을 명시적으로 검사 (title 컬럼이 합성 누락된 경로 방어).
 * - 공백으로 토큰을 분리해 모든 토큰이 어딘가 포함되면 매치(AND).
 * - 단일 토큰일 때는 기존 단순 부분 일치와 동일.
 */
export function rowMatchesSearch(
  row: DatabaseRowView,
  columns: ColumnDef[],
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const title = row.title.toLowerCase();
  // 컬럼별 검색 문자열을 한 번만 계산 (각 토큰마다 재계산 방지).
  const cellStrings = columns.map((col) =>
    cellToSearchString(row.cells[col.id], columns, col.id).toLowerCase(),
  );
  return tokens.every((tok) => {
    if (title.includes(tok)) return true;
    return cellStrings.some((s) => s.includes(tok));
  });
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

/** 단일 키 정렬 (구 시그니처 호환용 — 내부에서는 sortRowsMulti 사용). */
export function sortRows(
  rows: DatabaseRowView[],
  columnId: string | null,
  dir: "asc" | "desc",
  columns: ColumnDef[],
): DatabaseRowView[] {
  if (!columnId) return [...rows];
  return sortRowsMulti(rows, [{ columnId, dir }], columns);
}

/** 다중 키 정렬 — rules 배열의 앞쪽이 우선 키. 빈 배열이면 원본 순서 유지. */
export function sortRowsMulti(
  rows: DatabaseRowView[],
  rules: SortRule[],
  columns: ColumnDef[],
): DatabaseRowView[] {
  if (rules.length === 0) return [...rows];
  const colMap = new Map(columns.map((c) => [c.id, c]));
  return [...rows].sort((r1, r2) => {
    for (const rule of rules) {
      const col = colMap.get(rule.columnId);
      const cmp = compareCell(r1.cells[rule.columnId], r2.cells[rule.columnId], col);
      if (cmp !== 0) return rule.dir === "desc" ? -cmp : cmp;
    }
    return 0;
  });
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

/**
 * 검색·필터·정렬 일괄 적용.
 * sortRules 배열이 비어 있으면 원본 순서 유지 (다중 정렬, #4).
 */
export function applyFilterSortSearch(
  rowsOrdered: DatabaseRowView[],
  columns: ColumnDef[],
  searchQuery: string,
  filterRules: FilterRule[],
  sortRules: SortRule[],
): DatabaseRowView[] {
  const searched = rowsOrdered.filter((r) =>
    rowMatchesSearch(r, columns, searchQuery),
  );
  const filtered = applyFilters(searched, filterRules, columns);
  return sortRowsMulti(filtered, sortRules, columns);
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
