import { describe, expect, it } from "vitest";
import type { ColumnDef } from "../types/database";
import {
  getVisibleOrderedColumns,
  moveVisibleColumnInViewConfig,
  setColumnVisibleInViewConfig,
} from "../types/database";

const columns: ColumnDef[] = [
  { id: "title", name: "이름", type: "title" },
  { id: "status", name: "상태", type: "status" },
  { id: "date", name: "날짜", type: "date" },
];

describe("getVisibleOrderedColumns", () => {
  it("설정이 없으면 모든 뷰가 제목 포함 전체 컬럼을 표시한다 (모드 공통 기본값)", () => {
    // 회귀 방지: 칸반/타임라인/갤러리가 제각각 slice(0,2)·slice(0,1)·빈 배열로 폴백해
    // 설정 패널은 '전체 활성'인데 실제로는 일부만 보이던 불일치를 막는다.
    for (const viewKind of ["table", "list", "kanban", "timeline", "gallery"] as const) {
      expect(getVisibleOrderedColumns(columns, viewKind, undefined).map((col) => col.id))
        .toEqual(["title", "status", "date"]);
      expect(getVisibleOrderedColumns(columns, viewKind, {}).map((col) => col.id))
        .toEqual(["title", "status", "date"]);
    }
  });

  it("visibleColumnIds 순서를 뷰별 표시 순서로 사용한다", () => {
    const out = getVisibleOrderedColumns(columns, "table", {
      table: { visibleColumnIds: ["date", "title"] },
    });

    expect(out.map((col) => col.id)).toEqual(["date", "title"]);
  });

  it("뷰별 visibleColumnIds 순서를 서로 독립적으로 유지한다", () => {
    const viewConfigs = {
      timeline: { visibleColumnIds: ["date", "status", "title"] },
      gallery: { visibleColumnIds: ["status", "title"] },
    };

    expect(getVisibleOrderedColumns(columns, "timeline", viewConfigs).map((col) => col.id))
      .toEqual(["date", "status", "title"]);
    expect(getVisibleOrderedColumns(columns, "gallery", viewConfigs).map((col) => col.id))
      .toEqual(["status", "title"]);
  });

  it("visibleColumnIds 빈 배열은 제목만 유지하고 전체 표시로 폴백하지 않는다", () => {
    const out = getVisibleOrderedColumns(columns, "table", {
      table: { visibleColumnIds: [] },
    });

    expect(out.map((col) => col.id)).toEqual(["title"]);
  });

  it("hiddenColumnIds가 있으면 visibleColumnIds를 전체 순서로 해석해 숨김 위치를 유지한다", () => {
    const out = getVisibleOrderedColumns(columns, "table", {
      table: { visibleColumnIds: ["title", "status", "date"], hiddenColumnIds: ["status"] },
    });

    expect(out.map((col) => col.id)).toEqual(["title", "date"]);
  });

  it("표시 비활성화 후 다시 활성화해도 기존 위치를 유지한다", () => {
    const hidden = setColumnVisibleInViewConfig(
      columns,
      "table",
      {},
      "status",
      false,
    );

    expect(hidden.visibleColumnIds).toEqual(["title", "status", "date"]);
    expect(hidden.hiddenColumnIds).toEqual(["status"]);
    expect(getVisibleOrderedColumns(columns, "table", { table: hidden }).map((col) => col.id))
      .toEqual(["title", "date"]);

    const shown = setColumnVisibleInViewConfig(
      columns,
      "table",
      hidden,
      "status",
      true,
    );

    expect(shown.visibleColumnIds).toEqual(["title", "status", "date"]);
    expect(shown.hiddenColumnIds).toEqual([]);
    expect(getVisibleOrderedColumns(columns, "table", { table: shown }).map((col) => col.id))
      .toEqual(["title", "status", "date"]);
  });

  it("표 컬럼 드래그는 숨김 컬럼 위치를 보존하면서 보이는 컬럼 순서만 바꾼다", () => {
    const next = moveVisibleColumnInViewConfig(
      columns,
      "table",
      { visibleColumnIds: ["title", "status", "date"], hiddenColumnIds: ["status"] },
      0,
      1,
    );

    expect(next.visibleColumnIds).toEqual(["date", "status", "title"]);
    expect(next.hiddenColumnIds).toEqual(["status"]);
    expect(getVisibleOrderedColumns(columns, "table", { table: next }).map((col) => col.id))
      .toEqual(["date", "title"]);
  });
});
