import { describe, it, expect } from "vitest";
import type { ColumnDef, DatabaseRowView } from "../../../types/database";
import {
  GROUP_UNASSIGNED,
  GROUPABLE_COLUMN_TYPES,
  buildRowGroups,
  getGroupableColumns,
  isGroupableColumn,
  resolveRowGroupKeys,
  type GroupLabelContext,
} from "../grouping";

// 라벨 컨텍스트 — 멤버만 채우고 나머지는 빈 값.
const ctx = (members: Array<{ memberId: string; name: string; email: string }> = []): GroupLabelContext => ({
  databases: {},
  pages: {},
  members,
  scopeCtx: { organizations: [], teams: [], projects: [] },
});

const statusCol: ColumnDef = {
  id: "c-status",
  name: "상태",
  type: "status",
  config: {
    options: [
      { id: "todo", label: "시작전", color: "#ff0000" },
      { id: "done", label: "완료", color: "#00ff00" },
    ],
  },
};

const personCol: ColumnDef = { id: "c-person", name: "담당자", type: "person" };

const row = (pageId: string, cells: Record<string, unknown>): DatabaseRowView => ({
  pageId,
  databaseId: "db1",
  title: pageId,
  cells: cells as DatabaseRowView["cells"],
});

describe("grouping engine", () => {
  describe("isGroupableColumn / getGroupableColumns", () => {
    it("person/status/select 만 그룹화 가능", () => {
      expect(GROUPABLE_COLUMN_TYPES).toEqual(new Set(["person", "status", "select"]));
      expect(isGroupableColumn(statusCol)).toBe(true);
      expect(isGroupableColumn(personCol)).toBe(true);
      expect(isGroupableColumn({ id: "t", name: "텍스트", type: "text" })).toBe(false);
      expect(isGroupableColumn({ id: "d", name: "날짜", type: "date" })).toBe(false);
    });

    it("getGroupableColumns 는 순서를 보존하며 그룹 가능 컬럼만 반환", () => {
      const cols: ColumnDef[] = [
        { id: "title", name: "제목", type: "title" },
        statusCol,
        { id: "n", name: "숫자", type: "number" },
        personCol,
      ];
      expect(getGroupableColumns(cols).map((c) => c.id)).toEqual(["c-status", "c-person"]);
    });
  });

  describe("resolveRowGroupKeys", () => {
    it("status 단일 문자열 → 단일 키", () => {
      expect(resolveRowGroupKeys(row("p1", { "c-status": "todo" }), statusCol)).toEqual(["todo"]);
    });
    it("person 배열 → 다중 키", () => {
      expect(resolveRowGroupKeys(row("p1", { "c-person": ["m1", "m2"] }), personCol)).toEqual([
        "m1",
        "m2",
      ]);
    });
    it("빈 값 → 빈 배열", () => {
      expect(resolveRowGroupKeys(row("p1", { "c-status": null }), statusCol)).toEqual([]);
      expect(resolveRowGroupKeys(row("p1", {}), personCol)).toEqual([]);
      expect(resolveRowGroupKeys(row("p1", { "c-person": [] }), personCol)).toEqual([]);
    });
  });

  describe("buildRowGroups - status/select", () => {
    it("옵션 순서대로 정렬하고 미지정은 마지막", () => {
      const rows = [
        row("p1", { "c-status": "done" }),
        row("p2", { "c-status": "todo" }),
        row("p3", { "c-status": null }),
        row("p4", { "c-status": "todo" }),
      ];
      const groups = buildRowGroups(rows, statusCol, ctx());
      expect(groups.map((g) => g.key)).toEqual(["todo", "done", GROUP_UNASSIGNED]);
      expect(groups[0]!.label).toBe("시작전");
      expect(groups[0]!.color).toBe("#ff0000");
      expect(groups[0]!.rows.map((r) => r.pageId)).toEqual(["p2", "p4"]); // 입력 순서 보존
      expect(groups[2]!.label).toBe("미지정");
      expect(groups[2]!.rows.map((r) => r.pageId)).toEqual(["p3"]);
    });

    it("행이 없는 옵션 그룹은 제외", () => {
      const groups = buildRowGroups([row("p1", { "c-status": "todo" })], statusCol, ctx());
      expect(groups.map((g) => g.key)).toEqual(["todo"]);
    });

    it("옵션에 없는 잔여 키는 옵션 그룹 뒤·미지정 앞에 배치", () => {
      const rows = [
        row("p1", { "c-status": "todo" }),
        row("p2", { "c-status": "stale-id" }),
        row("p3", { "c-status": null }),
      ];
      const groups = buildRowGroups(rows, statusCol, ctx());
      expect(groups.map((g) => g.key)).toEqual(["todo", "stale-id", GROUP_UNASSIGNED]);
    });
  });

  describe("buildRowGroups - person 다중값", () => {
    it("다중 멤버 행은 각 그룹에 모두 표시(노션 방식)", () => {
      const members = [
        { memberId: "m1", name: "홍길동", email: "" },
        { memberId: "m2", name: "이순신", email: "" },
      ];
      const rows = [
        row("p1", { "c-person": ["m1", "m2"] }),
        row("p2", { "c-person": ["m1"] }),
        row("p3", { "c-person": [] }),
      ];
      const groups = buildRowGroups(rows, personCol, ctx(members));
      const byKey = new Map(groups.map((g) => [g.key, g]));
      expect(byKey.get("m1")!.label).toBe("홍길동");
      expect(byKey.get("m1")!.rows.map((r) => r.pageId)).toEqual(["p1", "p2"]);
      expect(byKey.get("m2")!.rows.map((r) => r.pageId)).toEqual(["p1"]); // p1 이 두 그룹에 중복
      expect(byKey.get("m1")!.color).toMatch(/^#[0-9a-f]{6}$/i); // personChipColor
      expect(byKey.get(GROUP_UNASSIGNED)!.rows.map((r) => r.pageId)).toEqual(["p3"]);
      // 미지정은 항상 마지막
      expect(groups[groups.length - 1]!.key).toBe(GROUP_UNASSIGNED);
    });
  });
});
