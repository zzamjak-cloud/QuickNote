// uuid v4 생성기. 모든 모던 브라우저에서 crypto.randomUUID() 사용 가능.
export function newId(): string {
  return crypto.randomUUID();
}
