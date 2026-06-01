import type {
  CellValue,
  ColumnDef,
  DatabasePanelState,
  DatabaseRowView,
  FilterOperator,
  FilterRule,
  SortRule,
} from "../types/database";
import { stringifyJsonValue } from "./database/jsonCell";

/**
 * panelState에서 현재 활성화된 필터 규칙을 해석한다.
 * 활성 프리셋이 있으면 그 규칙을, 없으면 전역 filterRules를 사용한다.
 */
export function resolveActiveFilterRules(
  panelState: DatabasePanelState,
): FilterRule[] {
  const activePreset =
    (panelState.filterPresets ?? []).find(
      (preset) => preset.id === panelState.activePresetId,
    ) ?? null;
  return activePreset?.filterRules ?? panelState.filterRules ?? [];
}

export function cellToSearchString(
  value: CellValue,
  columns: ColumnDef[],
  columnId: string,
): string {
  if (value === null || value === undefined) return "";
  const col = columns.find((c) => c.id === columnId);
  if (typeof value === "string") {
    return (
      col?.config?.options?.find((option) => !option.divider && option.id === value)
        ?.label ?? value
    );
  }
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
  return stringifyJsonValue(value);
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

// 빈 값(null/undefined/빈 문자열/빈 배열) 검사 — 정렬 시 항상 마지막 anchor 용.
function isEmptyCell(v: CellValue): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") {
    const d = v as { start?: unknown; end?: unknown };
    if ("start" in d || "end" in d) {
      const s = typeof d.start === "string" ? d.start.trim() : "";
      const e = typeof d.end === "string" ? d.end.trim() : "";
      return !s && !e;
    }
  }
  return false;
}

/** 정렬 비교 — 빈 값 anchor 는 sortRowsMulti 에서 dir 무관하게 처리. 여기서는 값이 있는 두 셀만 비교. */
function compareCell(
  a: CellValue,
  b: CellValue,
  col: ColumnDef | undefined,
): number {
  if (a === b) return 0;
  if (col?.type === "number") {
    const na = typeof a === "number" ? a : Number(a);
    const nb = typeof b === "number" ? b : Number(b);
    if (!Number.isFinite(na) && !Number.isFinite(nb)) return 0;
    if (!Number.isFinite(na)) return 1;
    if (!Number.isFinite(nb)) return -1;
    return na - nb;
  }
  if (col?.type === "date") {
    // date 셀 — { start, end } 또는 ISO 문자열. ISO 시작 문자열로 비교.
    const sa = dateSortKey(a);
    const sb = dateSortKey(b);
    if (sa === sb) return 0;
    if (!sa) return 1;
    if (!sb) return -1;
    return sa < sb ? -1 : 1;
  }
  // select / multiSelect — 옵션 순서대로 정렬 (id 첫 항목의 column.options 인덱스로 안정 정렬).
  if (Array.isArray(a) || Array.isArray(b)) {
    const ka = selectSortKey(a, col);
    const kb = selectSortKey(b, col);
    if (ka === kb) return 0;
    return ka < kb ? -1 : 1;
  }
  const sa = cellToSearchString(a, col ? [col] : [], col?.id ?? "");
  const sb = cellToSearchString(b, col ? [col] : [], col?.id ?? "");
  return sa.localeCompare(sb, "ko");
}

function dateSortKey(v: CellValue): string {
  if (!v) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object" && "start" in (v as object)) {
    const d = v as { start?: string; end?: string };
    return (d.start ?? d.end ?? "").trim();
  }
  return "";
}

function selectSortKey(v: CellValue, col: ColumnDef | undefined): string {
  if (!Array.isArray(v) || v.length === 0) return "￿"; // empty 는 뒤로
  const ids = v as string[];
  const opts = col?.config?.options ?? [];
  // 옵션 정의 순서대로 인덱스를 매겨 안정 정렬. 미정의 옵션은 라벨 fallback.
  const firstId = ids[0]!;
  const optIndex = opts.findIndex((o) => o.id === firstId);
  if (optIndex >= 0) {
    // 정의된 옵션은 인덱스 zero-padded 로 안정 정렬용 키 사용.
    return optIndex.toString().padStart(6, "0");
  }
  // 옵션에 없는 경우 라벨/ID 직접 사용 (z 로 시작해 정의된 옵션보다 항상 뒤).
  return `z${firstId}`;
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

/**
 * 다중 키 정렬 — rules 배열의 앞쪽이 우선 키. 빈 배열이면 원본 순서 유지.
 * 빈 값(null/undefined/빈 문자열/빈 배열/빈 date) 은 방향(asc/desc) 과 무관하게 항상 뒤로 anchor.
 * — desc 정렬에서 빈 값이 맨 위로 올라와 "중간중간 뒤섞이는" 회귀를 막는다.
 */
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
      const a = r1.cells[rule.columnId];
      const b = r2.cells[rule.columnId];
      const aEmpty = isEmptyCell(a);
      const bEmpty = isEmptyCell(b);
      if (aEmpty && bEmpty) continue;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      const cmp = compareCell(a, b, col);
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
  const target = rule.value ?? "";
  const rawStringValues = Array.isArray(raw)
    ? (raw as unknown[]).filter((value): value is string => typeof value === "string")
    : typeof raw === "string"
      ? [raw]
      : [];

  switch (rule.operator) {
    case "isEmpty":
      return empty;
    case "isNotEmpty":
      return !empty;
    case "contains":
      return str.toLowerCase().includes(target.toLowerCase()) || rawStringValues.some((value) => value === target);
    case "equals":
      return str === target || rawStringValues.includes(target);
    case "notEquals":
      return str !== target && !rawStringValues.includes(target);
    case "gt":
      if (col?.type === "number") {
        const n = typeof raw === "number" ? raw : Number(raw);
        const t = Number(target);
        return Number.isFinite(n) && Number.isFinite(t) && n > t;
      }
      return str > target;
    case "lt":
      if (col?.type === "number") {
        const n = typeof raw === "number" ? raw : Number(raw);
        const t = Number(target);
        return Number.isFinite(n) && Number.isFinite(t) && n < t;
      }
      return str < target;
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
