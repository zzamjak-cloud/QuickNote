// unknown 에러를 사용자 표시용 문자열로 정규화.
export function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
