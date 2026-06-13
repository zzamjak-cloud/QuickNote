/** 빈 catch 대신 원인 추적용 — 고빈도 경로에서만 호출하지 말 것 */

/** ring buffer 한 항목 */
interface NonFatalEntry {
  time: number;
  context: string;
  message: string;
  stack?: string;
}

/** 최근 에러 보관 개수 상한 */
const RING_CAPACITY = 50;

/** devtools 조회용 전역 핸들 타입 (store 등 무거운 의존성 없이 최소 선언) */
declare global {
  interface Window {
    __QN_errors?: NonFatalEntry[];
  }
}

/** 메모리 내 ring buffer (모듈 단일 인스턴스) */
const ring: NonFatalEntry[] = [];

/** window.__QN_errors 가 항상 현재 ring 을 가리키도록 보장 */
function ensureGlobalExposed(): void {
  if (typeof window === "undefined") return;
  if (window.__QN_errors !== ring) {
    window.__QN_errors = ring;
  }
}

/** ring buffer 에 항목 push (상한 초과 시 가장 오래된 것 제거) */
function pushToRing(entry: NonFatalEntry): void {
  ring.push(entry);
  if (ring.length > RING_CAPACITY) {
    ring.splice(0, ring.length - RING_CAPACITY);
  }
  ensureGlobalExposed();
}

/** 앱 버전 (빌드 주입 env 가 있으면 사용, 없으면 unknown — 새 인프라 불필요) */
function readVersion(): string {
  try {
    const env = import.meta.env as Record<string, string | undefined>;
    return env?.VITE_APP_VERSION ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** beacon 전송 (URL 미설정이면 no-op, 실패는 전부 swallow) */
function sendBeacon(entry: NonFatalEntry): void {
  try {
    const env = import.meta.env as Record<string, string | undefined>;
    const url = env?.VITE_ERROR_BEACON_URL;
    if (!url) return;
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") {
      return;
    }
    const payload = JSON.stringify({
      context: entry.context,
      message: entry.message,
      stack: entry.stack,
      ts: entry.time,
      version: readVersion(),
    });
    navigator.sendBeacon(url, payload);
  } catch {
    // 관측성 부가 기능 실패가 본 흐름을 깨면 안 됨 — 전부 무시
  }
}

export function reportNonFatal(err: unknown, context: string): void {
  const e = err instanceof Error ? err : new Error(String(err));

  // 기존 개발 편의 출력 유지
  console.warn(`[QuickNote] ${context}`, e);

  // 렌더 순수성과 무관한 일반 함수이므로 Date.now() 안전
  const entry: NonFatalEntry = {
    time: Date.now(),
    context,
    message: e.message,
    stack: e.stack,
  };

  pushToRing(entry);
  sendBeacon(entry);
}
