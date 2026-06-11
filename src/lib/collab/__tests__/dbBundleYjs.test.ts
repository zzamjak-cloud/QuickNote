import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { seedDbStructure, readDbStructure, DB_ROOT_KEY } from "../dbBundleYjs";

const sampleStructure = {
  columns: [
    { id: "c1", name: "제목", type: "title" },
    { id: "c2", name: "상태", type: "select", options: [{ id: "o1", label: "진행" }] },
  ],
  presets: [{ id: "p1", name: "전체", rules: [] }],
  panelState: { viewConfigs: { table: { hiddenColumnIds: ["c2"] } }, sort: { columnId: "c1", dir: "asc" } },
  rowPageOrder: ["pg1", "pg2"],
  rows: { pg1: { c2: "o1" }, pg2: { c2: null } },
  rowMembers: ["pg1", "pg2"],
};

describe("dbBundleYjs", () => {
  it("seed → read 라운드트립이 구조를 보존한다", () => {
    const doc = new Y.Doc();
    seedDbStructure(doc, sampleStructure);
    expect(readDbStructure(doc)).toEqual(sampleStructure);
  });
  it("이미 시드된 Y.Doc 은 재시드하지 않는다", () => {
    const doc = new Y.Doc();
    seedDbStructure(doc, sampleStructure);
    seedDbStructure(doc, { columns: [{ id: "x", name: "X", type: "text" }], presets: [], panelState: {}, rowPageOrder: [], rows: {}, rowMembers: [] });
    expect(readDbStructure(doc).columns).toHaveLength(2);
  });
  it("두 Y.Doc 에 동시 컬럼 추가가 둘 다 보존된다(수렴)", () => {
    const a = new Y.Doc();
    seedDbStructure(a, sampleStructure);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    (a.getMap(DB_ROOT_KEY).get("columns") as Y.Array<unknown>).push([newCol("c3")]);
    (b.getMap(DB_ROOT_KEY).get("columns") as Y.Array<unknown>).push([newCol("c4")]);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const ids = readDbStructure(a).columns.map((c) => (c as { id: string }).id);
    expect(ids).toContain("c3");
    expect(ids).toContain("c4");
    expect(readDbStructure(a)).toEqual(readDbStructure(b));
  });
  it("rows 도 seed → read 라운드트립으로 보존된다", () => {
    const doc = new Y.Doc();
    seedDbStructure(doc, sampleStructure);
    expect(readDbStructure(doc).rows).toEqual(sampleStructure.rows);
  });
  it("rows 누락 Y.Doc 은 빈 객체로 읽힌다", () => {
    const doc = new Y.Doc();
    seedDbStructure(doc, { columns: [], presets: [], panelState: {}, rowPageOrder: [], rows: {}, rowMembers: [] });
    doc.getMap(DB_ROOT_KEY).delete("rows"); // 구버전 doc 시뮬레이션
    expect(readDbStructure(doc).rows).toEqual({});
  });
  it("rowMembers 도 seed → read 라운드트립으로 보존된다", () => {
    const doc = new Y.Doc();
    seedDbStructure(doc, sampleStructure);
    expect(readDbStructure(doc).rowMembers).toEqual(sampleStructure.rowMembers);
  });
  it("rowMembers 누락 Y.Doc 은 빈 배열로 읽힌다", () => {
    const doc = new Y.Doc();
    seedDbStructure(doc, { columns: [], presets: [], panelState: {}, rowPageOrder: [], rows: {}, rowMembers: [] });
    doc.getMap(DB_ROOT_KEY).delete("rowMembers");
    expect(readDbStructure(doc).rowMembers).toEqual([]);
  });
});

function newCol(id: string) {
  const m = new Y.Map();
  m.set("id", id); m.set("name", id); m.set("type", "text");
  return m;
}
