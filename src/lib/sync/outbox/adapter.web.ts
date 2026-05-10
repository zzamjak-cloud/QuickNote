import Dexie, { type Table } from "dexie";
import type { OutboxAdapter, OutboxEntry } from "./types";

// 웹 환경 outbox — IndexedDB 영속화. 단일 DB 단일 store.
class OutboxDb extends Dexie {
  entries!: Table<OutboxEntry, string>;
  deadLetters!: Table<OutboxEntry & { deadLetterReason: string; deadLetterAt: number }, string>;

  constructor() {
    super("quicknote-outbox");
    this.version(1).stores({
      entries: "id, enqueuedAt, dedupeKey",
    });
    this.version(2).stores({
      entries: "id, enqueuedAt, dedupeKey",
      deadLetters: "id, enqueuedAt, dedupeKey, deadLetterAt",
    });
  }
}

export class DexieOutboxAdapter implements OutboxAdapter {
  private db = new OutboxDb();

  async put(entry: OutboxEntry): Promise<void> {
    await this.db.entries.put(entry);
  }

  async list(limit: number): Promise<OutboxEntry[]> {
    return this.db.entries.orderBy("enqueuedAt").limit(limit).toArray();
  }

  async remove(id: string): Promise<void> {
    await this.db.entries.delete(id);
  }

  async upsertByDedupe(entry: OutboxEntry): Promise<void> {
    await this.db.transaction("rw", this.db.entries, async () => {
      const existing = await this.db.entries
        .where("dedupeKey")
        .equals(entry.dedupeKey)
        .first();
      if (existing) await this.db.entries.delete(existing.id);
      await this.db.entries.put(entry);
    });
  }

  async clear(): Promise<void> {
    await this.db.entries.clear();
  }

  async putDeadLetter(entry: OutboxEntry, reason: string): Promise<void> {
    await this.db.deadLetters.put({
      ...entry,
      deadLetterReason: reason,
      deadLetterAt: Date.now(),
    });
  }

  async listDeadLetters(
    limit: number,
  ): Promise<Array<OutboxEntry & { deadLetterReason: string }>> {
    return this.db.deadLetters
      .orderBy("deadLetterAt")
      .reverse()
      .limit(limit)
      .toArray();
  }
}
