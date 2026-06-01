import type { KVStorage } from "./adapter";
import {
  isPrunableCacheKey,
  selectCacheKeysToPrune,
} from "./cacheQuota";

const DB_NAME = "quicknote-web-kv";
const DB_VERSION = 1;
const STORE_NAME = "kv_store";

// IDB 캐시 quota:
// - HARD_LIMIT: 이를 초과하면 prune 트리거
// - TARGET: prune 후 도달하고자 하는 목표 크기 (LRU 기반 삭제)

// setItem 호출 N회마다 prune 검사 (매번 검사하면 비용 큼)
const PRUNE_CHECK_INTERVAL = 24;

let dbPromise: Promise<IDBDatabase> | null = null;
let writeCount = 0;

type WebKvRecord = {
  value: string;
  updatedAt: number;
  size: number;
};

function openWebKvDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("[storage] indexedDB open blocked"));
  });
  return dbPromise;
}

function idbGetItem(key: string): Promise<string | null> {
  return openWebKvDatabase().then(
    (db) =>
      new Promise<string | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => {
          const value = req.result;
          if (typeof value === "string") {
            resolve(value);
            return;
          }
          if (
            value &&
            typeof value === "object" &&
            typeof (value as WebKvRecord).value === "string"
          ) {
            resolve((value as WebKvRecord).value);
            return;
          }
          resolve(null);
        };
        req.onerror = () => reject(req.error);
      }),
  );
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * IDB quota 초과 시 LRU 기반으로 삭제 가능한 캐시 키인지 판정.
 *
 * 키 네이밍 규약:
 * - "quicknote.{domain}.cache.{tag}.v{N}"  → prunable (서버에서 재페치 가능한 캐시)
 * - "quicknote.{domain}.v{N}"              → preserved (사용자 컨텐츠·설정 — 손실 금지)
 *
 * 새 캐시 키를 만들 때 서버에서 재페치 가능하면 반드시 ".cache." segment 를 포함시켜
 * 자동 prune 대상에 들어가도록 한다.
 */
function idbSetItem(key: string, value: string): Promise<void> {
  return openWebKvDatabase().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const record: WebKvRecord = {
          value,
          updatedAt: Date.now(),
          size: byteLength(value),
        };
        store.put(record, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

function idbRemoveItem(key: string): Promise<void> {
  return openWebKvDatabase().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

function readLocalStorageFallback(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorageFallback(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // noop
  }
}

function removeLocalStorageFallback(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // noop
  }
}

async function pruneIndexedDbCachesIfNeeded(): Promise<void> {
  const db = await openWebKvDatabase();
  const entries = await new Promise<Array<{ key: string; size: number; updatedAt: number }>>((resolve, reject) => {
    const rows: Array<{ key: string; size: number; updatedAt: number }> = [];
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(rows);
        return;
      }
      const key = String(cursor.key);
      const value = cursor.value as unknown;
      if (isPrunableCacheKey(key)) {
        if (typeof value === "string") {
          rows.push({ key, size: byteLength(value), updatedAt: 0 });
        } else if (value && typeof value === "object") {
          const rec = value as Partial<WebKvRecord>;
          rows.push({
            key,
            size: typeof rec.size === "number" ? rec.size : byteLength(typeof rec.value === "string" ? rec.value : ""),
            updatedAt: typeof rec.updatedAt === "number" ? rec.updatedAt : 0,
          });
        }
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });

  const totalBytes = entries.reduce((sum, row) => sum + row.size, 0);
  const keysToDelete = selectCacheKeysToPrune(entries);
  const deletedBytes = entries
    .filter((row) => keysToDelete.includes(row.key))
    .reduce((sum, row) => sum + row.size, 0);
  const reclaimed = totalBytes - deletedBytes;
  if (keysToDelete.length === 0) return;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const key of keysToDelete) {
      store.delete(key);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  console.warn("[storage] indexedDB cache pruned", {
    deleted: keysToDelete.length,
    beforeBytes: totalBytes,
    afterBytes: reclaimed,
  });
}

/** 웹 환경 Zustand persist 저장소 — IndexedDB 우선, localStorage 하위 호환 fallback */
export const webStorage: KVStorage = {
  async getItem(key) {
    try {
      const value = await idbGetItem(key);
      if (value != null) return value;
    } catch (error) {
      console.warn("[storage] indexedDB read failed, localStorage fallback", key, error);
    }

    const legacy = readLocalStorageFallback(key);
    if (legacy == null) return null;

    // localStorage에 남아있는 기존 persist 값을 IndexedDB로 점진 이전
    try {
      await idbSetItem(key, legacy);
      removeLocalStorageFallback(key);
    } catch {
      // noop
    }
    return legacy;
  },

  async setItem(key, value) {
    try {
      await idbSetItem(key, value);
      // 이전 버전의 잔여 localStorage 키는 정리
      removeLocalStorageFallback(key);
      writeCount += 1;
      if (isPrunableCacheKey(key) && writeCount % PRUNE_CHECK_INTERVAL === 0) {
        void pruneIndexedDbCachesIfNeeded().catch((error) => {
          console.warn("[storage] indexedDB prune failed", error);
        });
      }
      return;
    } catch (error) {
      console.warn("[storage] indexedDB write failed, localStorage fallback", key, error);
    }
    writeLocalStorageFallback(key, value);
  },

  async removeItem(key) {
    try {
      await idbRemoveItem(key);
    } catch (error) {
      console.warn("[storage] indexedDB remove failed, localStorage fallback", key, error);
    }
    removeLocalStorageFallback(key);
  },
};
