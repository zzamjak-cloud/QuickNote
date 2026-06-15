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

// http(s):// 로 시작하는 값은 URL 링크다. 노션 URL 속성을 텍스트로 내보낼 때
// '/' 가 multiSelect 구분자로 쪼개져(https:, 도메인, 경로 조각…) 다중 선택으로
// 오판되던 문제를 막기 위해 url 타입으로 우선 판정한다.
function isUrlValue(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return v.startsWith("http://") || v.startsWith("https://");
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

// 약한 person 헤더 힌트 — 단독으로는 person 으로 단정하지 않고
// 값이 사람 이름 패턴을 가질 때만 person 으로 본다("이름" 컬럼이 일반 텍스트인 경우 보호).
function headerWeaklySuggestsPerson(headerLower: string): boolean {
  return (
    headerLower.includes("이름") ||
    headerLower.includes("name") ||
    headerLower.includes("구성원") ||
    headerLower.includes("멤버") ||
    headerLower.includes("member") ||
    headerLower.includes("assignee")
  );
}

// "최진평 [CAT]" / "이다은[BK]" 처럼 이름 뒤에 대괄호 태그가 붙은 토큰 패턴.
// 노션에서 사람 속성을 텍스트로 내보낼 때 흔히 나타나는 강한 person 신호.
const PERSON_BRACKET_TOKEN = /^[\p{L}][\p{L}\s.]*\[[^\]]+\]$/u;

// 값의 모든 구분자 분할 조각이 "이름 [태그]" 패턴이면 사람 값으로 본다.
function looksLikeBracketedPersonValue(raw: string): boolean {
  const parts = raw
    .split(/[;,/|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((p) => PERSON_BRACKET_TOKEN.test(p));
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

  // URL 값 컬럼은 '/' 토큰 분할로 multiSelect 오판되므로 url(링크)로 우선 판정한다.
  if (
    nonEmpty.length > 0 &&
    nonEmpty.filter(isUrlValue).length / nonEmpty.length >= 0.7
  ) {
    return "url";
  }

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

  // 헤더 키워드 없이도 "이름 [태그]" 패턴이 다수면 person 으로 판정 (강한 신호).
  const bracketPersonCount = nonEmpty.filter((v) => looksLikeBracketedPersonValue(v)).length;
  if (bracketPersonCount / nonEmpty.length >= 0.6) return "person";

  // 값이 사람 이름 토큰으로 잘 분해되고, 헤더가 강/약 person 힌트를 가지면 person.
  const personTokenCount = nonEmpty.filter((v) => splitPersonTokens(v).length > 0).length;
  if (
    personTokenCount / nonEmpty.length >= 0.8 &&
    (headerSuggestsPerson(headerLower) || headerWeaklySuggestsPerson(headerLower))
  ) {
    return "person";
  }

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
