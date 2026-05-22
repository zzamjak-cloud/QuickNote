import type { KVStorage } from "./adapter";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let _resolved: KVStorage | null = null;
let _promise: Promise<KVStorage> | null = null;

function resolve(): Promise<KVStorage> {
  if (_resolved) return Promise.resolve(_resolved);
  if (!_promise) {
    _promise = (async () => {
      if (isTauri) {
        const { tauriStorage } = await import("./tauri");
        _resolved = tauriStorage;
      } else {
        const { webStorage } = await import("./web");
        _resolved = webStorage;
      }
      return _resolved;
    })();
  }
  return _promise;
}

// Zustand createJSONStorage(() => zustandStorage) 에 전달할 StateStorage 구현.
// 메서드가 Promise를 반환해도 Zustand persist가 올바르게 await 한다.

let _writesPaused = false;
// 일시 정지 중 쓴 키 추적 — resume 시 최종 상태를 한 번에 flush
const _pendingWrites = new Map<string, string>();

export function pauseStorageWrites(): void {
  _writesPaused = true;
  _pendingWrites.clear();
}

export async function resumeStorageWrites(): Promise<void> {
  _writesPaused = false;
  const storage = await resolve();
  for (const [key, value] of _pendingWrites) {
    await storage.setItem(key, value);
  }
  _pendingWrites.clear();
}

export const zustandStorage: KVStorage = {
  getItem: (key) => resolve().then((s) => s.getItem(key)),
  setItem: (key, value) => {
    if (_writesPaused) {
      // 마지막 값만 보관 (중간 상태 불필요)
      _pendingWrites.set(key, value as string);
      return Promise.resolve();
    }
    return resolve().then((s) => s.setItem(key, value));
  },
  removeItem: (key) => resolve().then((s) => s.removeItem(key)),
};
