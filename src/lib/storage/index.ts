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
export const zustandStorage: KVStorage = {
  getItem: (key) => resolve().then((s) => s.getItem(key)),
  setItem: (key, value) => resolve().then((s) => s.setItem(key, value)),
  removeItem: (key) => resolve().then((s) => s.removeItem(key)),
};
