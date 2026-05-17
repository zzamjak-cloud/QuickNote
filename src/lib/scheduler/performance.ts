const PERF_FLAG_KEY = "quicknote.scheduler.perf";

export function isSchedulerPerfEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PERF_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function nowSchedulerPerf(): number {
  if (typeof performance === "undefined") return Date.now();
  return performance.now();
}

export function logSchedulerPerf(label: string, startedAt: number, extra?: Record<string, unknown>): void {
  if (!isSchedulerPerfEnabled()) return;
  const endedAt = nowSchedulerPerf();
  console.info("[scheduler:perf]", label, {
    durationMs: Math.round((endedAt - startedAt) * 10) / 10,
    ...extra,
  });
}
