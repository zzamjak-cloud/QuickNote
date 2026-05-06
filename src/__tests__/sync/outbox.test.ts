import { describe, it, expect } from "vitest";
import { MemoryOutboxAdapter } from "../../lib/sync/outbox/adapter.memory";
import type { OutboxEntry } from "../../lib/sync/outbox/types";

function entry(over: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: "e-1",
    op: "upsertPage",
    payload: { id: "p-1" },
    enqueuedAt: Date.now(),
    attempts: 0,
    dedupeKey: "upsertPage:p-1",
    ...over,
  };
}

describe("MemoryOutboxAdapter", () => {
  it("put + list returns entries in enqueuedAt order", async () => {
    const a = new MemoryOutboxAdapter();
    await a.put(entry({ id: "1", enqueuedAt: 100 }));
    await a.put(entry({ id: "2", enqueuedAt: 50, dedupeKey: "k2" }));
    const items = await a.list(10);
    expect(items.map((x) => x.id)).toEqual(["2", "1"]);
  });

  it("remove deletes entry and frees dedupeKey", async () => {
    const a = new MemoryOutboxAdapter();
    await a.put(entry({ id: "1", dedupeKey: "k" }));
    await a.remove("1");
    expect((await a.list(10)).length).toBe(0);
    await a.put(entry({ id: "2", dedupeKey: "k" }));
    expect((await a.list(10)).length).toBe(1);
  });

  it("upsertByDedupe replaces existing", async () => {
    const a = new MemoryOutboxAdapter();
    await a.put(entry({ id: "1", dedupeKey: "k", payload: { v: 1 } }));
    await a.upsertByDedupe(entry({ id: "2", dedupeKey: "k", payload: { v: 2 } }));
    const items = await a.list(10);
    expect(items.length).toBe(1);
    expect(items[0].id).toBe("2");
    expect(items[0].payload).toEqual({ v: 2 });
  });

  it("clear empties the store", async () => {
    const a = new MemoryOutboxAdapter();
    await a.put(entry({ id: "1" }));
    await a.clear();
    expect((await a.list(10)).length).toBe(0);
  });
});
