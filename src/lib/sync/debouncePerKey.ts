// 키별로 마지막 호출만 남기는 디바운서. 페이지 doc 변경처럼 한 키에 여러 호출이 몰릴 때 사용.

type Timer = ReturnType<typeof setTimeout>;
// 대기 중인 호출을 즉시 실행(flush)할 수 있도록 타이머와 함께 콜백도 보관한다.
type Pending = { timer: Timer; fn: () => void };
const pending = new Map<string, Pending>();

export function debouncePerKey(key: string, ms: number, fn: () => void): void {
  const existing = pending.get(key);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    pending.delete(key);
    fn();
  }, ms);
  pending.set(key, { timer, fn });
}

/**
 * 대기 중인 디바운스 호출을 즉시 실행한다(predicate 로 키를 필터).
 * 예: 노션 가져오기 종료 시 `page:` doc 동기화 enqueue 가 2초 idle 발사 전 유실되는 것을 막는다.
 */
export function flushDebouncedKeys(predicate?: (key: string) => boolean): void {
  for (const [key, p] of [...pending.entries()]) {
    if (predicate && !predicate(key)) continue;
    clearTimeout(p.timer);
    pending.delete(key);
    p.fn();
  }
}
