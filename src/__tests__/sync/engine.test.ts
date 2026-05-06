import { describe, it, expect } from "vitest";
import { SyncEngine, type GqlBridge } from "../../lib/sync/engine";
import { MemoryOutboxAdapter } from "../../lib/sync/outbox/adapter.memory";

type Call = [string, ...unknown[]];

function makeGql(): GqlBridge & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    upsertPage: async (i) => {
      calls.push(["upsertPage", i]);
    },
    upsertDatabase: async (i) => {
      calls.push(["upsertDatabase", i]);
    },
    upsertContact: async (i) => {
      calls.push(["upsertContact", i]);
    },
    softDeletePage: async (id, u) => {
      calls.push(["softDeletePage", id, u]);
    },
    softDeleteDatabase: async (id, u) => {
      calls.push(["softDeleteDatabase", id, u]);
    },
    softDeleteContact: async (id, u) => {
      calls.push(["softDeleteContact", id, u]);
    },
  };
}

describe("SyncEngine", () => {
  it("dispatches enqueued mutations and clears outbox", async () => {
    const outbox = new MemoryOutboxAdapter();
    const gql = makeGql();
    const engine = new SyncEngine(outbox, gql);
    await engine.enqueue("upsertPage", {
      id: "p-1",
      updatedAt: "2026-05-06T00:00:00Z",
    });
    await engine.flush();
    expect(gql.calls.length).toBe(1);
    expect(gql.calls[0]![0]).toBe("upsertPage");
    expect((await outbox.list(10)).length).toBe(0);
  });

  it("dedupes consecutive enqueues for the same op+id", async () => {
    const outbox = new MemoryOutboxAdapter();
    const gql = makeGql();
    const engine = new SyncEngine(outbox, gql);
    await engine.enqueue("upsertPage", { id: "p-1", updatedAt: "t1" });
    await engine.enqueue("upsertPage", { id: "p-1", updatedAt: "t2" });
    expect((await outbox.list(10)).length).toBe(1);
    await engine.flush();
    expect(gql.calls.length).toBe(1);
    const first = gql.calls[0]!;
    expect((first[1] as { updatedAt: string }).updatedAt).toBe("t2");
  });

  it("retries on failure with backoff bookkeeping", async () => {
    const outbox = new MemoryOutboxAdapter();
    let fail = true;
    const base = makeGql();
    const gql: GqlBridge = {
      ...base,
      upsertPage: async () => {
        if (fail) {
          fail = false;
          throw new Error("network");
        }
      },
    };
    const engine = new SyncEngine(outbox, gql);
    await engine.enqueue("upsertPage", { id: "p-1" });
    await engine.flush();
    const after = await outbox.list(10);
    expect(after.length).toBe(1);
    expect(after[0]!.attempts).toBe(1);
    await engine.flush();
    expect((await outbox.list(10)).length).toBe(0);
  });
});
