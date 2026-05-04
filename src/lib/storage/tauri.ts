import Database from "@tauri-apps/plugin-sql";
import type { KVStorage } from "./adapter";

let _db: Database | null = null;

async function db(): Promise<Database> {
  if (!_db) {
    _db = await Database.load("sqlite:quicknote.db");
  }
  return _db;
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
    await conn.execute(
      "INSERT OR REPLACE INTO kv_store (key, value) VALUES ($1, $2)",
      [key, value],
    );
  },

  async removeItem(key) {
    const conn = await db();
    await conn.execute("DELETE FROM kv_store WHERE key=$1", [key]);
  },
};
