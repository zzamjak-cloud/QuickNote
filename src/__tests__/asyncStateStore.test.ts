import { describe, it, expect } from "vitest";
import { AsyncStateStore } from "../lib/auth/asyncStateStore";
import type { KVStorage } from "../lib/storage/adapter";

function memoryStorage(): KVStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
  };
}

describe("AsyncStateStore", () => {
  it("set/get/remove 라운드트립", async () => {
    const store = new AsyncStateStore(memoryStorage(), "p");
    await store.set("a", "1");
    await store.set("b", "2");
    expect(await store.get("a")).toBe("1");
    expect(await store.get("missing")).toBeNull();

    expect(await store.remove("a")).toBe("1");
    expect(await store.get("a")).toBeNull();
    expect(await store.remove("a")).toBeNull();
  });

  it("getAllKeys 는 살아있는 키만 반환한다", async () => {
    const store = new AsyncStateStore(memoryStorage(), "p");
    await store.set("x", "1");
    await store.set("y", "2");
    await store.set("z", "3");
    await store.remove("y");
    const keys = (await store.getAllKeys()).sort();
    expect(keys).toEqual(["x", "z"]);
  });

  it("prefix 가 다르면 키 충돌 없음", async () => {
    const kv = memoryStorage();
    const a = new AsyncStateStore(kv, "ns-a");
    const b = new AsyncStateStore(kv, "ns-b");
    await a.set("k", "from-a");
    await b.set("k", "from-b");
    expect(await a.get("k")).toBe("from-a");
    expect(await b.get("k")).toBe("from-b");
  });
});
