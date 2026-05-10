import type { OutboxAdapter, OutboxEntry } from "./types";

// 단위 테스트 및 임시 환경용. 영속화 없음.
export class MemoryOutboxAdapter implements OutboxAdapter {
  private byId = new Map<string, OutboxEntry>();
  private byDedupe = new Map<string, string>();
  private deadLetters: Array<OutboxEntry & { deadLetterReason: string }> = [];

  async put(entry: OutboxEntry): Promise<void> {
    this.byId.set(entry.id, entry);
    this.byDedupe.set(entry.dedupeKey, entry.id);
  }

  async list(limit: number): Promise<OutboxEntry[]> {
    return Array.from(this.byId.values())
      .sort((a, b) => a.enqueuedAt - b.enqueuedAt)
      .slice(0, limit);
  }

  async remove(id: string): Promise<void> {
    const entry = this.byId.get(id);
    if (entry) this.byDedupe.delete(entry.dedupeKey);
    this.byId.delete(id);
  }

  async upsertByDedupe(entry: OutboxEntry): Promise<void> {
    const existingId = this.byDedupe.get(entry.dedupeKey);
    if (existingId) this.byId.delete(existingId);
    this.byId.set(entry.id, entry);
    this.byDedupe.set(entry.dedupeKey, entry.id);
  }

  async clear(): Promise<void> {
    this.byId.clear();
    this.byDedupe.clear();
  }

  async putDeadLetter(entry: OutboxEntry, reason: string): Promise<void> {
    this.deadLetters.push({ ...entry, deadLetterReason: reason });
  }

  async listDeadLetters(
    limit: number,
  ): Promise<Array<OutboxEntry & { deadLetterReason: string }>> {
    return this.deadLetters.slice(-limit);
  }
}
