// 공용 타입 가드 모음.

/** null/배열을 제외한 순수 객체(Record) 여부. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
