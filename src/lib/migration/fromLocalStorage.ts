import type { KVStorage } from "../storage/adapter";

// Zustand persist 가 사용하는 스토리지 키
const PERSIST_KEYS = [
  "quicknote.pageStore.v1",
  "quicknote.databaseStore.v2",
  "quicknote.settings.v1",
] as const;

const MIGRATION_DONE_KEY = "quicknote.migrated.v2";

export function hasLocalStorageData(): boolean {
  if (localStorage.getItem(MIGRATION_DONE_KEY)) return false;
  return PERSIST_KEYS.some((key) => localStorage.getItem(key) !== null);
}

// localStorage의 Zustand persist JSON 블롭을 SQLite kv_store로 그대로 복사.
// 키 구조가 동일하므로 변환 없이 이전 가능.
export async function migrateFromLocalStorage(storage: KVStorage): Promise<void> {
  for (const key of PERSIST_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) {
      await storage.setItem(key, value);
      localStorage.removeItem(key);
    }
  }
  localStorage.setItem(MIGRATION_DONE_KEY, "true");
}
