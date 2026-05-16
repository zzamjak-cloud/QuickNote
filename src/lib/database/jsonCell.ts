import type { JsonValue } from "../../types/database";

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return typeof value !== "number" || Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (isPlainJsonObject(value)) {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

export function normalizeJsonValue(value: unknown): JsonValue | null {
  if (value == null) return null;
  if (!isJsonValue(value)) return null;
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export function parseJsonValueInput(input: string): { ok: true; value: JsonValue | null } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, value: null };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const normalized = normalizeJsonValue(parsed);
    if (normalized == null && parsed !== null) {
      return { ok: false, error: "JSON으로 저장할 수 없는 값입니다." };
    }
    return { ok: true, value: normalized };
  } catch {
    return { ok: false, error: "올바른 JSON 형식이 아닙니다." };
  }
}

export function stringifyJsonValue(value: unknown): string {
  const normalized = normalizeJsonValue(value);
  if (normalized == null) return "";
  return JSON.stringify(normalized, null, 2);
}

export function summarizeJsonValue(value: unknown): string {
  const normalized = normalizeJsonValue(value);
  if (normalized == null) return "비어 있음";
  if (Array.isArray(normalized)) return `배열 ${normalized.length}개`;
  if (typeof normalized === "object") return `객체 ${Object.keys(normalized).length}개 키`;
  return String(normalized);
}
