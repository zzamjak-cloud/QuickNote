/** 빈 catch 대신 원인 추적용 — 고빈도 경로에서만 호출하지 말 것 */
export function reportNonFatal(err: unknown, context: string): void {
  const e = err instanceof Error ? err : new Error(String(err));
  console.warn(`[QuickNote] ${context}`, e);
}
