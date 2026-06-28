// 새 배포가 나가면 해시 기반 청크 파일명이 바뀐다. 이전 index.html 을 띄워둔 클라이언트가
// lazy import 로 옛 청크를 요청하면 그 파일이 더는 없어 "Failed to fetch dynamically imported module"
// 로 실패한다(새로고침하면 새 index 가 로드되어 해결). 이를 자동 1회 새로고침으로 복구한다.

import { forcePwaUpdate } from "./pwa/swController";

const RELOAD_TS_KEY = "qn:chunkReloadAt";
// stale precache(PWA) 강제 교체 1회 마커 — 일반 새로고침으로도 안 풀릴 때.
const SW_ESCALATE_TS_KEY = "qn:chunkReloadSwEscalateAt";
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
 * 청크 로드 실패 시 1회 강제 새로고침. 쿨다운(15s) 내 재시도면 일반 새로고침으로는
 * 안 풀린 것이므로 stale precache(PWA SW)를 의심해 SW 강제 교체로 1회 escalation 한다.
 * 그것마저 쿨다운 내 반복되면 false 로 무한 루프를 막는다.
 */
export function attemptChunkReload(): boolean {
  const now = Date.now();
  let last = 0;
  try {
    last = Number(globalThis.sessionStorage?.getItem(RELOAD_TS_KEY) ?? "0");
  } catch {
    // sessionStorage 비가용 — 아래에서 1회 새로고침 시도.
  }

  if (now - last < RELOAD_COOLDOWN_MS) {
    // 이미 새로고침했는데 또 청크 실패 → stale precache 의심 → SW 강제 교체 1회.
    try {
      const lastEscalate = Number(
        globalThis.sessionStorage?.getItem(SW_ESCALATE_TS_KEY) ?? "0",
      );
      if (now - lastEscalate < RELOAD_COOLDOWN_MS) return false; // 교체도 이미 시도 — 중단.
      globalThis.sessionStorage?.setItem(SW_ESCALATE_TS_KEY, String(now));
    } catch {
      return false;
    }
    void forcePwaUpdate();
    return true;
  }

  try {
    globalThis.sessionStorage?.setItem(RELOAD_TS_KEY, String(now));
  } catch {
    // 무시 — 그래도 1회는 새로고침한다.
  }
  window.location.reload();
  return true;
}
