// 키별로 마지막 호출만 남기는 디바운서. 페이지 doc 변경처럼 한 키에 여러 호출이 몰릴 때 사용.

type Timer = ReturnType<typeof setTimeout>;
const timers = new Map<string, Timer>();

export function debouncePerKey(key: string, ms: number, fn: () => void): void {
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    timers.delete(key);
    fn();
  }, ms);
  timers.set(key, t);
}
