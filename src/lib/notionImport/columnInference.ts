import type { ColumnType } from "../../types/database";
import {
  splitPersonTokens,
} from "./personName";

type OptionMeta = {
  statusLike: boolean;
  selectedCount: number;
  selectedOptions: Array<{ label: string; colorToken: string | null }>;
  hasPerson: boolean;
  personNames: string[];
  hasTimeTag: boolean;
  statusColorToken: string | null;
};

export type InferColumnInput = {
  header: string;
  values: string[];
  meta?: OptionMeta[];
};

export function parseDateLike(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const ymd = text.match(/(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/);
  if (ymd) return `${ymd[1]}-${ymd[2]?.padStart(2, "0")}-${ymd[3]?.padStart(2, "0")}`;
  const short = text.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (short) return `${new Date().getFullYear()}-${short[1]?.padStart(2, "0")}-${short[2]?.padStart(2, "0")}`;
  return null;
}

function splitMultiSelectTokens(raw: string): string[] {
  const src = raw.trim();
  if (!src) return [];
  const parts = src.split(/[;,|/]/).map((s) => s.trim()).filter(Boolean);
  return Array.from(new Set(parts));
}

function headerSuggestsStatus(headerLower: string): boolean {
  return (
    headerLower.includes("상태") ||
    headerLower.includes("status") ||
    headerLower.includes("진행")
  );
}

function headerSuggestsPerson(headerLower: string): boolean {
  return (
    headerLower.includes("담당") ||
    headerLower.includes("담당자") ||
    headerLower.includes("작성자") ||
    headerLower.includes("멘토") ||
    headerLower.includes("person") ||
    headerLower.includes("owner")
  );
}

function headerSuggestsDate(headerLower: string): boolean {
  return (
    headerLower.includes("날짜") ||
    headerLower.includes("일자") ||
    headerLower.includes("date") ||
    headerLower.includes("일정")
  );
}

export function inferNotionColumnType(input: InferColumnInput): ColumnType {
  const headerLower = input.header.toLowerCase();
  const nonEmpty = input.values.map((v) => v.trim()).filter(Boolean);
  const meta = input.meta ?? [];

  if (headerSuggestsDate(headerLower)) return "date";
  if (headerSuggestsPerson(headerLower)) return "person";

  if (meta.length > 0) {
    const hasTimeLike = meta.some((m) => m.hasTimeTag);
    const hasPerson = meta.some((m) => m.hasPerson || m.personNames.length > 0);
    const maxSelected = meta.reduce((max, m) => Math.max(max, m.selectedCount), 0);
    const hasStatusLike = meta.some((m) => m.statusLike || !!m.statusColorToken);
    if (hasTimeLike) return "date";
    if (hasPerson) return "person";
    if (maxSelected >= 2) return "multiSelect";
    if (maxSelected === 1) return headerSuggestsStatus(headerLower) || hasStatusLike ? "status" : "select";
  }

  if (nonEmpty.length === 0) return "text";
  if (nonEmpty.every((v) => /^-?\d+([.,]\d+)?$/.test(v))) return "number";

  const dateCount = nonEmpty.filter((v) => parseDateLike(v) != null).length;
  if (dateCount / nonEmpty.length >= 0.7) return "date";

  const personTokenCount = nonEmpty.filter((v) => splitPersonTokens(v).length > 0).length;
  if (personTokenCount / nonEmpty.length >= 0.8 && headerSuggestsPerson(headerLower)) return "person";

  const multiRows = nonEmpty.filter((v) => splitMultiSelectTokens(v).length >= 2).length;
  if (multiRows / nonEmpty.length >= 0.5) return "multiSelect";

  const unique = new Set(nonEmpty);
  if (unique.size > 0 && unique.size <= 12 && nonEmpty.length >= unique.size * 2) {
    return headerSuggestsStatus(headerLower) ? "status" : "select";
  }

  return "text";
}

export function mapNotionColorToQuickNote(token: string | null | undefined): string | undefined {
  if (!token) return undefined;
  const map: Record<string, string> = {
    gray: "#6b7280",
    brown: "#a16207",
    orange: "#ea580c",
    yellow: "#ca8a04",
    green: "#16a34a",
    blue: "#2563eb",
    purple: "#9333ea",
    pink: "#db2777",
    red: "#dc2626",
  };
  return map[token.trim().toLowerCase()];
}

export function normalizeImportedCellValue(
  columnType: ColumnType,
  raw: string,
): string | string[] | { start: string } | null {
  if (columnType === "date") {
    const parsed = parseDateLike(raw);
    return parsed ? { start: parsed } : raw;
  }
  if (columnType === "multiSelect") {
    return splitMultiSelectTokens(raw);
  }
  if (columnType === "person") {
    return splitPersonTokens(raw);
  }
  return raw;
}
