import type { PersistStorage, StorageValue } from "zustand/middleware";
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
  // 대기 중인 deferred 항목을 즉시 _pendingWrites로 이동 (resume 시 누락 방지)
  for (const inst of _deferredInstances) {
    inst.flushToPendingWrites();
  }
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
      _pendingWrites.set(key, value as string);
      return Promise.resolve();
    }
    return resolve().then((s) => s.setItem(key, value));
  },
  removeItem: (key) => resolve().then((s) => s.removeItem(key)),
};

// ---------------------------------------------------------------------------
// deferredStorage: JSON.stringify 를 setTimeout 으로 미뤄 메인 스레드 블로킹 제거.
// createJSONStorage 대신 persist({ storage }) 에 직접 전달한다.
// ---------------------------------------------------------------------------

const DEFERRED_FLUSH_MS = 300;

interface DeferredInstance {
  flushToPendingWrites(): void;
}

const _deferredInstances: DeferredInstance[] = [];

/**
 * persist() 의 storage 옵션에 직접 전달할 수 있는 deferred storage 를 생성한다.
 * 각 store 가 독립된 pending 큐를 가져야 하므로 호출마다 새 인스턴스 반환.
 * createJSONStorage 와 달리 JSON.stringify 가 setTimeout(300ms) 으로 미뤄져
 * set() 호출 시 메인 스레드 블로킹 없음.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function makeDeferredStorage<S = any>(): PersistStorage<S> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pending = new Map<string, StorageValue<any>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function doFlush(name: string): void {
    const value = pending.get(name);
    if (value === undefined) return;
    pending.delete(name);
    timers.delete(name);
    const str = JSON.stringify(value);
    if (_writesPaused) {
      _pendingWrites.set(name, str);
    } else {
      resolve().then((s) => s.setItem(name, str));
    }
  }

  function scheduleFlush(name: string): void {
    const t = timers.get(name);
    if (t) clearTimeout(t);
    timers.set(name, setTimeout(() => doFlush(name), DEFERRED_FLUSH_MS));
  }

  const inst: DeferredInstance = {
    flushToPendingWrites() {
      for (const name of [...pending.keys()]) {
        const t = timers.get(name);
        if (t) { clearTimeout(t); timers.delete(name); }
        const value = pending.get(name);
        if (value !== undefined) {
          pending.delete(name);
          _pendingWrites.set(name, JSON.stringify(value));
        }
      }
    },
  };
  _deferredInstances.push(inst);

  // 탭 닫기 직전 미flush 항목을 localStorage에 동기 기록
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
      for (const [name, value] of pending) {
        try { localStorage.setItem(name, JSON.stringify(value)); } catch { /* noop */ }
      }
    });
  }

  return {
    getItem: async (name) => {
      const s = await resolve();
      const str = await s.getItem(name);
      if (!str) return null;
      return JSON.parse(str) as StorageValue<S>;
    },
    setItem: (name, value) => {
      pending.set(name, value);
      scheduleFlush(name);
    },
    removeItem: async (name) => {
      pending.delete(name);
      const t = timers.get(name);
      if (t) { clearTimeout(t); timers.delete(name); }
      const s = await resolve();
      return s.removeItem(name);
    },
  };
}

export const deferredPageStorage = makeDeferredStorage();
export const deferredDatabaseStorage = makeDeferredStorage();
