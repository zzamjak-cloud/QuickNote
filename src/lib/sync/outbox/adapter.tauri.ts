import Database from "@tauri-apps/plugin-sql";
import type { OutboxAdapter, OutboxEntry } from "./types";

// 데스크톱(Tauri) outbox — 기존 quicknote.db SQLite 재활용. 단일 테이블.

let dbPromise: Promise<Database> | null = null;

function db(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const d = await Database.load("sqlite:quicknote.db");
      await d.execute(`
        CREATE TABLE IF NOT EXISTS outbox_entries (
          id TEXT PRIMARY KEY,
          op TEXT NOT NULL,
          payload TEXT NOT NULL,
          enqueuedAt INTEGER NOT NULL,
          attempts INTEGER NOT NULL,
          lastErrorAt INTEGER,
          dedupeKey TEXT NOT NULL UNIQUE
        );
      `);
      await d.execute(
        `CREATE INDEX IF NOT EXISTS idx_outbox_enqueuedAt ON outbox_entries(enqueuedAt);`,
      );
      return d;
    })();
  }
  return dbPromise;
}

type Row = {
  id: string;
  op: string;
  payload: string;
  enqueuedAt: number;
  attempts: number;
  lastErrorAt: number | null;
  dedupeKey: string;
};

function rowToEntry(r: Row): OutboxEntry {
  return {
    id: r.id,
    op: r.op as OutboxEntry["op"],
    payload: JSON.parse(r.payload),
    enqueuedAt: r.enqueuedAt,
    attempts: r.attempts,
    lastErrorAt: r.lastErrorAt ?? undefined,
    dedupeKey: r.dedupeKey,
  };
}

export class TauriOutboxAdapter implements OutboxAdapter {
  async put(entry: OutboxEntry): Promise<void> {
    const d = await db();
    await d.execute(
      `INSERT INTO outbox_entries(id, op, payload, enqueuedAt, attempts, lastErrorAt, dedupeKey)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         op=excluded.op, payload=excluded.payload, enqueuedAt=excluded.enqueuedAt,
         attempts=excluded.attempts, lastErrorAt=excluded.lastErrorAt, dedupeKey=excluded.dedupeKey`,
      [
        entry.id,
        entry.op,
        JSON.stringify(entry.payload),
        entry.enqueuedAt,
        entry.attempts,
        entry.lastErrorAt ?? null,
        entry.dedupeKey,
      ],
    );
  }

  async list(limit: number): Promise<OutboxEntry[]> {
    const d = await db();
    const rows = await d.select<Row[]>(
      `SELECT * FROM outbox_entries ORDER BY enqueuedAt ASC LIMIT ?`,
      [limit],
    );
    return rows.map(rowToEntry);
  }

  async remove(id: string): Promise<void> {
    const d = await db();
    await d.execute(`DELETE FROM outbox_entries WHERE id = ?`, [id]);
  }

  async upsertByDedupe(entry: OutboxEntry): Promise<void> {
    // 같은 dedupeKey 로 거의 동시에 enqueue 가 일어나면 DELETE→INSERT 가
    // race 로 UNIQUE 충돌을 일으킨다. SQLite UPSERT 로 atomic 처리.
    const d = await db();
    await d.execute(
      `INSERT INTO outbox_entries(id, op, payload, enqueuedAt, attempts, lastErrorAt, dedupeKey)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(dedupeKey) DO UPDATE SET
         id=excluded.id, op=excluded.op, payload=excluded.payload,
         enqueuedAt=excluded.enqueuedAt, attempts=excluded.attempts,
         lastErrorAt=excluded.lastErrorAt`,
      [
        entry.id,
        entry.op,
        JSON.stringify(entry.payload),
        entry.enqueuedAt,
        entry.attempts,
        entry.lastErrorAt ?? null,
        entry.dedupeKey,
      ],
    );
  }

  async clear(): Promise<void> {
    const d = await db();
    await d.execute(`DELETE FROM outbox_entries`);
  }
}
