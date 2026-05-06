import { ulid } from "./ulid";
import type {
  OutboxAdapter,
  OutboxEntry,
  OutboxOp,
} from "./outbox/types";

// 동기화 엔진. enqueue 시 outbox 에 적재 → 백그라운드 워커가 mutation 으로 flush.
// 같은 (op, id) 의 새 enqueue 는 dedupe 로 마지막 본만 남김.
// 실패 시 지수 백오프 재시도(최대 60초).

export interface GqlBridge {
  upsertPage(input: unknown): Promise<void>;
  upsertDatabase(input: unknown): Promise<void>;
  upsertContact(input: unknown): Promise<void>;
  softDeletePage(id: string, updatedAt: string): Promise<void>;
  softDeleteDatabase(id: string, updatedAt: string): Promise<void>;
  softDeleteContact(id: string, updatedAt: string): Promise<void>;
}

const MAX_BACKOFF_MS = 60_000;

export type EnqueuePayload = { id: string; updatedAt?: string };

export class SyncEngine {
  private flushing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly outbox: OutboxAdapter;
  private readonly gql: GqlBridge;
  private readonly clock: () => number;

  constructor(
    outbox: OutboxAdapter,
    gql: GqlBridge,
    clock: () => number = () => Date.now(),
  ) {
    this.outbox = outbox;
    this.gql = gql;
    this.clock = clock;
  }

  async enqueue(op: OutboxOp, payload: EnqueuePayload): Promise<void> {
    const entry: OutboxEntry = {
      id: ulid(),
      op,
      payload,
      enqueuedAt: this.clock(),
      attempts: 0,
      dedupeKey: `${op}:${payload.id}`,
    };
    await this.outbox.upsertByDedupe(entry);
    this.scheduleFlush(0);
  }

  scheduleFlush(delayMs: number): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delayMs);
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (true) {
        const batch = await this.outbox.list(20);
        if (batch.length === 0) return;
        for (const entry of batch) {
          try {
            await this.execute(entry);
            await this.outbox.remove(entry.id);
          } catch (err) {
            void err;
            const attempts = entry.attempts + 1;
            const backoff = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** entry.attempts);
            await this.outbox.put({
              ...entry,
              attempts,
              lastErrorAt: this.clock(),
            });
            this.scheduleFlush(backoff);
            return;
          }
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private async execute(entry: OutboxEntry): Promise<void> {
    const p = entry.payload as EnqueuePayload;
    switch (entry.op) {
      case "upsertPage":
        return this.gql.upsertPage(p);
      case "upsertDatabase":
        return this.gql.upsertDatabase(p);
      case "upsertContact":
        return this.gql.upsertContact(p);
      case "softDeletePage":
        return this.gql.softDeletePage(p.id, p.updatedAt ?? "");
      case "softDeleteDatabase":
        return this.gql.softDeleteDatabase(p.id, p.updatedAt ?? "");
      case "softDeleteContact":
        return this.gql.softDeleteContact(p.id, p.updatedAt ?? "");
    }
  }
}
