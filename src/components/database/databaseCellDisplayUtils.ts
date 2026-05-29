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
  if (column.type === "date") {
    if (typeof value === "object" && !Array.isArray(value)) {
      const range = value as DateRangeValue;
      const start = typeof range.start === "string" ? formatYmdDisplay(range.start) : "";
      const end = typeof range.end === "string" ? formatYmdDisplay(range.end) : "";
      if (!start && !end) return "";
      if (start && end && start !== end) return `${start} ~ ${end}`;
      return start || end;
    }
    if (typeof value === "string") {
      return value.trim() ? formatYmdDisplay(value) : "";
    }
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

/**
 * 날짜 ISO 문자열을 `YYYY. MM. DD` 형식으로 표시한다.
 * 셀에 보이는 날짜와 동일한 가독성 형식을 제공하기 위함 — 시간/타임존 정보는 버린다.
 * 파싱 불가 시 원본을 정리한 문자열로 폴백.
 */
function formatYmdDisplay(iso: string): string {
  const trimmed = iso.trim();
  if (!trimmed) return "";
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return normalizeDateLikeString(trimmed);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}. ${mm}. ${dd}`;
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
