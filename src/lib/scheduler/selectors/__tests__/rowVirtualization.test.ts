import { describe, expect, it } from "vitest";
import { buildVirtualRows, getVirtualRowsHeight, getVisibleVirtualRows } from "../rowVirtualization";

describe("row virtualization", () => {
  it("행의 누적 top과 전체 높이를 계산한다", () => {
    const rows = buildVirtualRows(["a", "b", "c"], (_item, index) => [20, 30, 40][index] ?? 0);

    expect(rows.map((row) => ({ item: row.item, top: row.top, height: row.height }))).toEqual([
      { item: "a", top: 0, height: 20 },
      { item: "b", top: 20, height: 30 },
      { item: "c", top: 50, height: 40 },
    ]);
    expect(getVirtualRowsHeight(rows)).toBe(90);
  });

  it("viewport 주변 overscan 행만 반환한다", () => {
    const rows = buildVirtualRows(["a", "b", "c", "d"], () => 100);

    expect(getVisibleVirtualRows(rows, 175, 100, 25).map((row) => row.item)).toEqual(["b", "c", "d"]);
  });
});
