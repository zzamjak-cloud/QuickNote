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
      await ensureOutboxMetaColumns(d);
      return d;
    })();
  }
  return dbPromise;
}

async function ensureOutboxMetaColumns(d: Database): Promise<void> {
  const rows = await d.select<{ name: string }[]>(
    "PRAGMA table_info(outbox_entries)",
  );
  const names = new Set(rows.map((r) => r.name));
  if (!names.has("workspaceId")) {
    await d.execute(`ALTER TABLE outbox_entries ADD COLUMN workspaceId TEXT`);
  }
  if (!names.has("entityType")) {
    await d.execute(`ALTER TABLE outbox_entries ADD COLUMN entityType TEXT`);
  }
  if (!names.has("entityId")) {
    await d.execute(`ALTER TABLE outbox_entries ADD COLUMN entityId TEXT`);
  }
  if (!names.has("baseVersion")) {
    await d.execute(
      `ALTER TABLE outbox_entries ADD COLUMN baseVersion INTEGER`,
    );
  }
}

type Row = {
  id: string;
  op: string;
  payload: string;
  enqueuedAt: number;
  attempts: number;
  lastErrorAt: number | null;
  dedupeKey: string;
  workspaceId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  baseVersion?: number | null;
};

function rowToEntry(r: Row): OutboxEntry {
  const payload = JSON.parse(r.payload) as unknown;
  const base: OutboxEntry = {
    id: r.id,
    op: r.op as OutboxEntry["op"],
    payload,
    enqueuedAt: r.enqueuedAt,
    attempts: r.attempts,
    lastErrorAt: r.lastErrorAt ?? undefined,
    dedupeKey: r.dedupeKey,
  };
  if (r.workspaceId != null)
    base.workspaceId = r.workspaceId;
  if (r.entityType != null)
    base.entityType = r.entityType as OutboxEntry["entityType"];
  if (r.entityId != null) base.entityId = r.entityId;
  if (r.baseVersion != null) base.baseVersion = r.baseVersion;
  return base;
}

export class TauriOutboxAdapter implements OutboxAdapter {
  async put(entry: OutboxEntry): Promise<void> {
    const d = await db();
    await d.execute(
      `INSERT INTO outbox_entries(id, op, payload, enqueuedAt, attempts, lastErrorAt, dedupeKey, workspaceId, entityType, entityId, baseVersion)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         op=excluded.op, payload=excluded.payload, enqueuedAt=excluded.enqueuedAt,
         attempts=excluded.attempts, lastErrorAt=excluded.lastErrorAt, dedupeKey=excluded.dedupeKey,
         workspaceId=excluded.workspaceId, entityType=excluded.entityType, entityId=excluded.entityId, baseVersion=excluded.baseVersion`,
      [
        entry.id,
        entry.op,
        JSON.stringify(entry.payload),
        entry.enqueuedAt,
        entry.attempts,
        entry.lastErrorAt ?? null,
        entry.dedupeKey,
        entry.workspaceId ?? null,
        entry.entityType ?? null,
        entry.entityId ?? null,
        entry.baseVersion ?? null,
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
      `INSERT INTO outbox_entries(id, op, payload, enqueuedAt, attempts, lastErrorAt, dedupeKey, workspaceId, entityType, entityId, baseVersion)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(dedupeKey) DO UPDATE SET
         id=excluded.id, op=excluded.op, payload=excluded.payload,
         enqueuedAt=excluded.enqueuedAt, attempts=excluded.attempts,
         lastErrorAt=excluded.lastErrorAt,
         workspaceId=excluded.workspaceId, entityType=excluded.entityType, entityId=excluded.entityId, baseVersion=excluded.baseVersion`,
      [
        entry.id,
        entry.op,
        JSON.stringify(entry.payload),
        entry.enqueuedAt,
        entry.attempts,
        entry.lastErrorAt ?? null,
        entry.dedupeKey,
        entry.workspaceId ?? null,
        entry.entityType ?? null,
        entry.entityId ?? null,
        entry.baseVersion ?? null,
      ],
    );
  }

  async clear(): Promise<void> {
    const d = await db();
    await d.execute(`DELETE FROM outbox_entries`);
  }
}
