import Database from "@tauri-apps/plugin-sql";
import type { KVStorage } from "./adapter";
import {
  selectTauriCacheKeysToPrune,
  shouldCheckTauriPrune,
  type TauriCacheRow,
} from "./tauriQuota";

let _db: Database | null = null;
let writeCount = 0;

async function db(): Promise<Database> {
  if (!_db) {
    _db = await Database.load("sqlite:quicknote.db");
  }
  return _db;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

async function pruneTauriCachesIfNeeded(conn: Database): Promise<void> {
  const rows = await conn.select<TauriCacheRow[]>(
    "SELECT key, size, updated_at FROM kv_store WHERE key LIKE 'quicknote.%cache.%'",
  );
  const keysToDelete = selectTauriCacheKeysToPrune(rows);
  for (const key of keysToDelete) {
    await conn.execute("DELETE FROM kv_store WHERE key=$1", [key]);
  }
  if (keysToDelete.length > 0) {
    console.warn("[storage] tauri cache pruned", {
      deleted: keysToDelete.length,
    });
  }
}

export const tauriStorage: KVStorage = {
  async getItem(key) {
    const conn = await db();
    const rows = await conn.select<[{ value: string }]>(
      "SELECT value FROM kv_store WHERE key=$1",
      [key],
    );
    return rows[0]?.value ?? null;
  },

  async setItem(key, value) {
    const conn = await db();
    const now = Date.now();
    await conn.execute(
      `INSERT INTO kv_store (key, value, updated_at, size)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT(key) DO UPDATE SET
         value=excluded.value,
         updated_at=excluded.updated_at,
         size=excluded.size`,
      [key, value, now, byteLength(value)],
    );
    writeCount += 1;
    if (shouldCheckTauriPrune(key, writeCount)) {
      void pruneTauriCachesIfNeeded(conn).catch((error) => {
        console.warn("[storage] tauri cache prune failed", error);
      });
    }
  },

  async removeItem(key) {
    const conn = await db();
    await conn.execute("DELETE FROM kv_store WHERE key=$1", [key]);
  },
};
