// 새 배포가 나가면 해시 기반 청크 파일명이 바뀐다. 이전 index.html 을 띄워둔 클라이언트가
// lazy import 로 옛 청크를 요청하면 그 파일이 더는 없어 "Failed to fetch dynamically imported module"
// 로 실패한다(새로고침하면 새 index 가 로드되어 해결). 이를 자동 1회 새로고침으로 복구한다.

const RELOAD_TS_KEY = "qn:chunkReloadAt";
// 새로고침 후에도 같은 실패가 반복될 때 무한 루프를 막는 쿨다운.
const RELOAD_COOLDOWN_MS = 15_000;

export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    /failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /importing a module script failed/i.test(msg) || // Safari
    /dynamically imported module/i.test(msg) ||
    /loading chunk [\d]+ failed/i.test(msg) ||
    /loading css chunk/i.test(msg)
  );
}

/**
 * 청크 로드 실패 시 1회 강제 새로고침. 쿨다운(15s) 내 재시도면 false 를 반환해
 * (이미 새로고침했는데도 실패하는 경우) 무한 루프를 막는다.
 */
export function attemptChunkReload(): boolean {
  try {
    const last = Number(globalThis.sessionStorage?.getItem(RELOAD_TS_KEY) ?? "0");
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    globalThis.sessionStorage?.setItem(RELOAD_TS_KEY, String(Date.now()));
  } catch {
    // sessionStorage 비가용 — 그래도 1회는 시도한다.
  }
  window.location.reload();
  return true;
}
