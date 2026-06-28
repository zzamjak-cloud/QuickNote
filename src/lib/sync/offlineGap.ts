// 오프라인 지속 시간 추적 + 재접속 시 fetch 전략 escalation 기준.
//
// gap = (다시 온라인 시점) − (오프라인 진입 시점).
// 오프라인이 길수록 로컬 watermark 가 정체되어 delta 페치가 일부 서버 항목을 건너뛸 수 있다
// (댓글/유령페이지 회귀 패밀리). 갭이 크면 기준선 재확보로 escalation 해 자가치유한다.
//
// 임계값(확정): T1=10분 → meta-baseline, T2=24h → full(prune).

const OFFLINE_SINCE_KEY = "qn:offlineSince";
const T1_META_BASELINE_MS = 10 * 60 * 1000; // 10분
const T2_FULL_MS = 24 * 60 * 60 * 1000; // 24시간

export type ReconnectFetchStrategy = "delta" | "meta-baseline" | "full";

let initialized = false;

// 부팅 1회 호출(main.tsx). 오프라인 진입 시각을 기록한다(새로고침에도 살아남도록 sessionStorage).
export function initOfflineGapTracking() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  window.addEventListener("offline", () => {
    try {
      // 중복 offline 이벤트가 와도 최초 진입 시각을 유지한다.
      if (!sessionStorage.getItem(OFFLINE_SINCE_KEY)) {
        sessionStorage.setItem(OFFLINE_SINCE_KEY, String(Date.now()));
      }
    } catch {
      // sessionStorage 비가용 — 갭은 0 으로 처리(delta).
    }
  });
}

// 재접속 시 호출 — 오프라인 갭(ms)을 반환하고 기록을 비운다. 기록 없으면 0.
export function consumeOfflineGapMs(): number {
  try {
    const raw = sessionStorage.getItem(OFFLINE_SINCE_KEY);
    if (!raw) return 0;
    sessionStorage.removeItem(OFFLINE_SINCE_KEY);
    const since = Number(raw);
    if (!Number.isFinite(since)) return 0;
    return Math.max(0, Date.now() - since);
  } catch {
    return 0;
  }
}

export function reconnectStrategyForGap(gapMs: number): ReconnectFetchStrategy {
  if (gapMs >= T2_FULL_MS) return "full";
  if (gapMs >= T1_META_BASELINE_MS) return "meta-baseline";
  return "delta";
}
