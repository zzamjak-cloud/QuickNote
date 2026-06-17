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

  it("검색이 row.title을 직접 매치 (cells 합성 누락 방어)", () => {
    // cells에 title 컬럼이 없어도 row.title로 매치되어야 함.
    const noTitleCell: DatabaseRowView = {
      pageId: "x",
      databaseId: "d",
      title: "감마",
      cells: { n: 5, s: "a" },
    };
    expect(rowMatchesSearch(noTitleCell, columns, "감마")).toBe(true);
  });

  it("검색 토큰을 공백으로 분리해 AND 매치", () => {
    // "알파 10" → 알파 AND 10 → 행1만 매치.
    const out = applyFilterSortSearch(rows, columns, "알파 10", [], []);
    expect(out.map((r) => r.pageId)).toEqual(["1"]);
    // "알파 20" → 알파는 행1, 20은 행2에 있으므로 어떤 행도 두 토큰을 모두 갖지 않음.
    const out2 = applyFilterSortSearch(rows, columns, "알파 20", [], []);
    expect(out2).toHaveLength(0);
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

  it("다중 선택 value(equals)는 선택값 중 하나와 일치하면 통과한다", () => {
    const three: DatabaseRowView[] = [
      { pageId: "1", databaseId: "d", title: "알파", cells: { t: "알파", n: 10, s: "a" } },
      { pageId: "2", databaseId: "d", title: "베타", cells: { t: "베타", n: 20, s: "b" } },
      { pageId: "3", databaseId: "d", title: "감마", cells: { t: "감마", n: 5, s: "c" } },
    ];
    const rules: FilterRule[] = [
      { id: "r1", columnId: "s", operator: "equals", value: ["a", "b"] },
    ];
    const out = applyFilterSortSearch(three, columns, "", rules, []);
    expect(out.map((r) => r.pageId)).toEqual(["1", "2"]);
  });

  it("다중 선택 value(notEquals)는 선택값 어느 것과도 다른 행만 통과한다", () => {
    const three: DatabaseRowView[] = [
      { pageId: "1", databaseId: "d", title: "알파", cells: { t: "알파", n: 10, s: "a" } },
      { pageId: "2", databaseId: "d", title: "베타", cells: { t: "베타", n: 20, s: "b" } },
      { pageId: "3", databaseId: "d", title: "감마", cells: { t: "감마", n: 5, s: "c" } },
    ];
    const rules: FilterRule[] = [
      { id: "r1", columnId: "s", operator: "notEquals", value: ["a", "b"] },
    ];
    const out = applyFilterSortSearch(three, columns, "", rules, []);
    expect(out.map((r) => r.pageId)).toEqual(["3"]);
  });

  it("배열 셀값(multiSelect)도 선택값 중 하나라도 포함하면 통과한다", () => {
    const cols: ColumnDef[] = [
      { id: "t", name: "이름", type: "title" },
      { id: "m", name: "태그", type: "multiSelect" },
    ];
    const rs: DatabaseRowView[] = [
      { pageId: "1", databaseId: "d", title: "알파", cells: { t: "알파", m: ["x", "y"] } },
      { pageId: "2", databaseId: "d", title: "베타", cells: { t: "베타", m: ["z"] } },
    ];
    const rules: FilterRule[] = [
      { id: "r1", columnId: "m", operator: "equals", value: ["y", "w"] },
    ];
    const out = applyFilterSortSearch(rs, cols, "", rules, []);
    expect(out.map((r) => r.pageId)).toEqual(["1"]);
  });

  it("빈 다중 선택 value는 필터 비활성으로 전체 통과한다", () => {
    const rules: FilterRule[] = [
      { id: "r1", columnId: "s", operator: "equals", value: [] },
    ];
    const out = applyFilterSortSearch(rows, columns, "", rules, []);
    expect(out.map((r) => r.pageId)).toEqual(["1", "2"]);
  });
});
