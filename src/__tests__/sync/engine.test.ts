import { describe, it, expect, vi } from "vitest";
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
    softDeletePage: async (id, workspaceId, u) => {
      calls.push(["softDeletePage", id, workspaceId, u]);
    },
    softDeleteDatabase: async (id, workspaceId, u) => {
      calls.push(["softDeleteDatabase", id, workspaceId, u]);
    },
    updateMyClientPrefs: async (json) => {
      calls.push(["updateMyClientPrefs", json]);
    },
    upsertComment: async (i) => {
      calls.push(["upsertComment", i]);
    },
    softDeleteComment: async (id, workspaceId, u) => {
      calls.push(["softDeleteComment", id, workspaceId, u]);
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

  it("드랍 head: 영구 실패 entry 가 max attempts 에 도달하면 outbox 에서 제거된다", async () => {
    const outbox = new MemoryOutboxAdapter();
    const base = makeGql();
    const gql: GqlBridge = {
      ...base,
      upsertPage: async () => {
        throw new Error("Forbidden");
      },
    };
    const engine = new SyncEngine(outbox, gql);
    await engine.enqueue("upsertPage", { id: "stuck" });
    // attempts 가 max 에 도달할 때까지 반복 flush — 실제 시간 지연 없이 backoff 무시.
    for (let i = 0; i < 60; i++) {
      await engine.flush();
      const list = await outbox.list(10);
      if (list.length === 0) break;
      // backoff 우회를 위해 attempts 만 진행시킨다 (테스트 한정).
      await outbox.put({ ...list[0]!, attempts: list[0]!.attempts + 1 });
    }
    expect((await outbox.list(10)).length).toBe(0);
    expect(await outbox.listDeadLetters?.(10)).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        op: "upsertPage",
        deadLetterReason: "max-attempts-exceeded",
      }),
    ]);
  });

  it("non-blocking head: 영구 실패 entry 가 head 에 있어도 후속 entries 가 처리된다", async () => {
    const outbox = new MemoryOutboxAdapter();
    const base = makeGql();
    const gql: GqlBridge = {
      ...base,
      upsertPage: async (input) => {
        const id = (input as { id: string }).id;
        if (id === "stuck") throw new Error("Forbidden");
        base.calls.push(["upsertPage", input]);
      },
    };
    const engine = new SyncEngine(outbox, gql);
    // head 가 영원히 실패하는 entry, 그 뒤에 정상 entries.
    await engine.enqueue("upsertPage", { id: "stuck" });
    await engine.enqueue("upsertPage", { id: "ok-1" });
    await engine.enqueue("upsertPage", { id: "ok-2" });
    await engine.flush();
    // 정상 entries 는 같은 batch 안에서 처리되어야 한다.
    const okIds = base.calls
      .filter((c) => c[0] === "upsertPage")
      .map((c) => (c[1] as { id: string }).id);
    expect(okIds).toContain("ok-1");
    expect(okIds).toContain("ok-2");
  });

  it("updateMyClientPrefs 를 outbox 에서 전송한다", async () => {
    const outbox = new MemoryOutboxAdapter();
    const gql = makeGql();
    const engine = new SyncEngine(outbox, gql);
    const json = '{"v":1,"favoritePageIds":[],"favoritePageIdsUpdatedAt":1}';
    await engine.enqueue("updateMyClientPrefs", {
      id: "m-1",
      clientPrefs: json,
    });
    await engine.flush();
    expect(gql.calls).toEqual([["updateMyClientPrefs", json]]);
    expect((await outbox.list(10)).length).toBe(0);
  });

  it("flush 배치에서 현재 UI 워크스페이스 엔트리를 먼저 전송한다", async () => {
    const outbox = new MemoryOutboxAdapter();
    const gql = makeGql();
    let t = 0;
    const engine = new SyncEngine(
      outbox,
      gql,
      () => ++t,
      () => "ws-current",
    );
    await engine.enqueue("upsertPage", {
      id: "other-first",
      workspaceId: "ws-remote",
      updatedAt: "t-a",
    });
    await engine.enqueue("upsertPage", {
      id: "current-second",
      workspaceId: "ws-current",
      updatedAt: "t-b",
    });
    await engine.flush();
    expect(gql.calls[0]?.[0]).toBe("upsertPage");
    expect((gql.calls[0]![1] as { id: string }).id).toBe("current-second");
    expect((gql.calls[1]![1] as { id: string }).id).toBe("other-first");
  });

  it("enqueue 시 outbox 엔트리에 워크스페이스·엔티티 메타가 채워진다", async () => {
    const outbox = new MemoryOutboxAdapter();
    const gql = makeGql();
    const engine = new SyncEngine(outbox, gql);
    await engine.enqueue("upsertPage", {
      id: "p-1",
      workspaceId: "ws-1",
    });
    const list = await outbox.list(10);
    expect(list[0]!.workspaceId).toBe("ws-1");
    expect(list[0]!.entityType).toBe("page");
    expect(list[0]!.entityId).toBe("p-1");
  });

  it("플러시 시 UI 워크스페이스와 엔트리 메타가 다르면 경고 로그만 남긴다", async () => {
    const outbox = new MemoryOutboxAdapter();
    const gql = makeGql();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const engine = new SyncEngine(outbox, gql, () => Date.now(), () => "ws-ui");
    await engine.enqueue("upsertPage", {
      id: "p-1",
      workspaceId: "ws-remote",
      updatedAt: "t",
    });
    await engine.flush();
    expect(warn.mock.calls.some((c) => String(c[0]).includes("불일치"))).toBe(
      true,
    );
    expect((await outbox.list(10)).length).toBe(0);
    warn.mockRestore();
  });
});
