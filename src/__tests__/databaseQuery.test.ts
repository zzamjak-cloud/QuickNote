import { describe, expect, it } from "vitest";
import {
  applyFilterSortSearch,
  rowMatchesSearch,
} from "../lib/databaseQuery";
import type { ColumnDef, DatabaseRowView, FilterRule } from "../types/database";

const columns: ColumnDef[] = [
  { id: "t", name: "이름", type: "title" },
  { id: "n", name: "숫자", type: "number" },
  { id: "s", name: "상태", type: "status" },
];

const rows: DatabaseRowView[] = [
  { pageId: "1", databaseId: "d", title: "알파", cells: { t: "알파", n: 10, s: "a" } },
  { pageId: "2", databaseId: "d", title: "베타", cells: { t: "베타", n: 20, s: "b" } },
];

describe("databaseQuery", () => {
  it("rowMatchesSearch finds text", () => {
    expect(rowMatchesSearch(rows[0]!, columns, "알파")).toBe(true);
    expect(rowMatchesSearch(rows[0]!, columns, "없음")).toBe(false);
  });

  it("applyFilterSortSearch sorts by single rule", () => {
    const out = applyFilterSortSearch(
      rows,
      columns,
      "",
      [],
      [{ columnId: "n", dir: "desc" }],
    );
    expect(out.map((r) => r.pageId)).toEqual(["2", "1"]);
  });

  it("applyFilterSortSearch filters contains", () => {
    const rules: FilterRule[] = [
      { id: "r1", columnId: "t", operator: "contains", value: "베" },
    ];
    const out = applyFilterSortSearch(rows, columns, "", rules, []);
    expect(out).toHaveLength(1);
    expect(out[0]?.pageId).toBe("2");
  });

  it("applyFilterSortSearch supports multi-key sort (status then number)", () => {
    const more: DatabaseRowView[] = [
      { pageId: "1", databaseId: "d", title: "알파", cells: { t: "알파", n: 10, s: "a" } },
      { pageId: "2", databaseId: "d", title: "베타", cells: { t: "베타", n: 20, s: "a" } },
      { pageId: "3", databaseId: "d", title: "감마", cells: { t: "감마", n: 5, s: "b" } },
    ];
    // 1차: 상태 asc → s="a"가 먼저, s="b"가 다음. 2차: 숫자 desc → 20(2) > 10(1).
    const out = applyFilterSortSearch(more, columns, "", [], [
      { columnId: "s", dir: "asc" },
      { columnId: "n", dir: "desc" },
    ]);
    expect(out.map((r) => r.pageId)).toEqual(["2", "1", "3"]);
  });

  it("applyFilterSortSearch with empty sortRules preserves order", () => {
    const out = applyFilterSortSearch(rows, columns, "", [], []);
    expect(out.map((r) => r.pageId)).toEqual(["1", "2"]);
  });
});
