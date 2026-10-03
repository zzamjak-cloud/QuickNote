import { describe, it, expect } from "vitest";
import { diffBlockKeys, MAX_LCS_CELLS } from "./blockDiff";

describe("diffBlockKeys", () => {
  it("prefix/suffix + 중간 LCS 로 유지 쌍을 찾는다", () => {
    expect(diffBlockKeys(["a", "b", "c", "d", "e"], ["a", "x", "c", "y", "e"])).toEqual([
      [0, 0],
      [2, 2],
      [4, 4],
    ]);
    expect(diffBlockKeys(["a", "b"], ["a", "b"])).toEqual([[0, 0], [1, 1]]);
    expect(diffBlockKeys([], ["a"])).toEqual([]);
  });

  it("중간 구간 n*m 이 상한을 넘으면 prefix/suffix 만 유지(폴백)", () => {
    const n = Math.floor(Math.sqrt(MAX_LCS_CELLS)) + 2;
    const oldKeys = ["head", ...Array.from({ length: n }, (_, i) => `o${i}`), "keep", "tail"];
    const newKeys = ["head", ...Array.from({ length: n }, (_, i) => `n${i}`), "keep", "tail"];
    // "keep" 은 suffix 로 유지, 중간은 LCS 없이 전부 교체.
    expect(diffBlockKeys(oldKeys, newKeys)).toEqual([[0, 0], [n + 1, n + 1], [n + 2, n + 2]]);
    const mid = ["head", "o1", "same", ...Array.from({ length: n }, (_, i) => `o${i}x`), "tail"];
    const mid2 = ["head", "n1", "same", ...Array.from({ length: n }, (_, i) => `n${i}x`), "tail"];
    expect(diffBlockKeys(mid, mid2)).toEqual([[0, 0], [mid.length - 1, mid2.length - 1]]);
  });
});
