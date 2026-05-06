import { describe, it, expect } from "vitest";
import { initialOrder, between } from "../../lib/sync/fractionalOrder";

describe("initialOrder", () => {
  it("produces a non-empty key", () => {
    expect(initialOrder().length).toBeGreaterThan(0);
  });
});

describe("between", () => {
  it("produces a key strictly greater than left and less than right", () => {
    const a = between(null, null);
    const b = between(a, null);
    const c = between(a, b);
    expect(a < b).toBe(true);
    expect(a < c).toBe(true);
    expect(c < b).toBe(true);
  });

  it("supports inserting at head (left=null)", () => {
    const a = between(null, null);
    const head = between(null, a);
    expect(head < a).toBe(true);
  });

  it("supports inserting at tail (right=null)", () => {
    const a = between(null, null);
    const tail = between(a, null);
    expect(a < tail).toBe(true);
  });

  it("does not produce duplicate keys for many inserts in same gap", () => {
    const left = "a";
    let right = "z";
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const k = between(left, right);
      expect(seen.has(k)).toBe(false);
      seen.add(k);
      right = k;
    }
    void left;
  });
});
