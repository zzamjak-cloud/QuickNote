import type {
  CellValue,
  ColumnDef,
  DateRangeValue,
  FileCellItem,
} from "../../types/database";
import { summarizeJsonValue } from "../../lib/database/jsonCell";

export function databaseCellHasDisplayValue(
  value: CellValue,
  column: ColumnDef,
): boolean {
  if (column.type === "status") {
    return (column.config?.options ?? []).length > 0;
  }
  if (column.type === "select") {
    return (
      typeof value === "string" &&
      !!column.config?.options?.some((option) => option.id === value)
    );
  }
  if (column.type === "multiSelect") {
    const ids = stringArrayValue(value);
    return ids.some((id) =>
      !!column.config?.options?.some((option) => option.id === id),
    );
  }
  return formatPlainDisplay(value, column).length > 0;
}

export function stringArrayValue(value: CellValue): string[] {
  return Array.isArray(value)
    ? (value as unknown[]).filter((id): id is string => typeof id === "string")
    : [];
}

export function formatPlainDisplay(value: CellValue, column: ColumnDef): string {
  if (value === null || value === undefined) return "";
  if (column.type === "json") return summarizeJsonValue(value);
  if (column.type === "date" && typeof value === "object" && !Array.isArray(value)) {
    const range = value as DateRangeValue;
    const start =
      typeof range.start === "string"
        ? normalizeDateLikeString(range.start)
        : "";
    const end =
      typeof range.end === "string"
        ? normalizeDateLikeString(range.end)
        : "";
    if (!start && !end) return "";
    if (start && end) return `${start} ~ ${end}`;
    return start || end;
  }
  if (column.type === "file" && Array.isArray(value)) {
    const files = value.filter(
      (item): item is FileCellItem =>
        typeof item === "object" && item !== null && "fileId" in item,
    );
    return files.length > 0 ? `${files.length}개 파일` : "";
  }
  if (Array.isArray(value)) {
    return stringArrayValue(value).filter(Boolean).join(", ");
  }
  if (typeof value === "boolean") return value ? "예" : "아니오";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return normalizeDateLikeString(value);
  return "";
}

function normalizeDateLikeString(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  if (normalized.endsWith("T00:00:00")) {
    return normalized.slice(0, -9);
  }
  if (normalized.endsWith("T23:59:59")) {
    return normalized.slice(0, -9);
  }
  return normalized;
}
