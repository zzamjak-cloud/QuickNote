import { describe, expect, it } from "vitest";
import type { ColumnDef } from "../types/database";
import { getVisibleOrderedColumns } from "../types/database";

const columns: ColumnDef[] = [
  { id: "title", name: "이름", type: "title" },
  { id: "status", name: "상태", type: "status" },
  { id: "date", name: "날짜", type: "date" },
];

describe("getVisibleOrderedColumns", () => {
  it("visibleColumnIds가 있어도 실제 컬럼 순서를 우선한다", () => {
    const out = getVisibleOrderedColumns(columns, "table", {
      table: { visibleColumnIds: ["date", "title"] },
    });

    expect(out.map((col) => col.id)).toEqual(["title", "date"]);
  });

  it("visibleColumnIds 빈 배열은 제목만 유지하고 전체 표시로 폴백하지 않는다", () => {
    const out = getVisibleOrderedColumns(columns, "table", {
      table: { visibleColumnIds: [] },
    });

    expect(out.map((col) => col.id)).toEqual(["title"]);
  });
});
