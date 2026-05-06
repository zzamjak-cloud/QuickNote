import type { OutboxAdapter } from "./types";

// 환경별 outbox 어댑터 동적 로더. Vite 가 platform 별 청크로 분리.

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let resolved: OutboxAdapter | null = null;

export async function getOutboxAdapter(): Promise<OutboxAdapter> {
  if (resolved) return resolved;
  if (isTauri) {
    const { TauriOutboxAdapter } = await import("./adapter.tauri");
    resolved = new TauriOutboxAdapter();
  } else {
    const { DexieOutboxAdapter } = await import("./adapter.web");
    resolved = new DexieOutboxAdapter();
  }
  return resolved;
}
