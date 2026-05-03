import { describe, expect, it } from "vitest";
import {
  applyFilterSortSearch,
  rowMatchesSearch,
} from "../lib/databaseQuery";
import type { ColumnDef, DatabaseRowView, FilterRule } from "../types/database";

const columns: ColumnDef[] = [
  { id: "t", name: "이름", type: "title" },
  { id: "n", name: "숫자", type: "number" },
];

const rows: DatabaseRowView[] = [
  { pageId: "1", databaseId: "d", title: "알파", cells: { t: "알파", n: 10 } },
  { pageId: "2", databaseId: "d", title: "베타", cells: { t: "베타", n: 20 } },
];

describe("databaseQuery", () => {
  it("rowMatchesSearch finds text", () => {
    expect(rowMatchesSearch(rows[0]!, columns, "알파")).toBe(true);
    expect(rowMatchesSearch(rows[0]!, columns, "없음")).toBe(false);
  });

  it("applyFilterSortSearch sorts by column", () => {
    const out = applyFilterSortSearch(rows, columns, "", [], "n", "desc");
    expect(out.map((r) => r.pageId)).toEqual(["2", "1"]);
  });

  it("applyFilterSortSearch filters contains", () => {
    const rules: FilterRule[] = [
      { id: "r1", columnId: "t", operator: "contains", value: "베" },
    ];
    const out = applyFilterSortSearch(rows, columns, "", rules, null, "asc");
    expect(out).toHaveLength(1);
    expect(out[0]?.pageId).toBe("2");
  });
});
