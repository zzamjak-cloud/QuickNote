import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { seedDbStructure, readDbStructure, DB_ROOT_KEY } from "../dbBundleYjs";
import { reconcileStructureIntoYDoc } from "../dbStructureReconcile";

const base = {
  columns: [{ id: "c1", name: "제목", type: "title" }, { id: "c2", name: "상태", type: "select" }],
  presets: [], panelState: { sort: { columnId: "c1", dir: "asc" } }, rowPageOrder: ["p1"],
};

describe("reconcileStructureIntoYDoc", () => {
  it("로컬 컬럼 추가가 Y 에 반영된다", () => {
    const doc = new Y.Doc(); seedDbStructure(doc, base);
    const localNew = { ...base, columns: [...base.columns, { id: "c3", name: "새", type: "text" }] };
    reconcileStructureIntoYDoc(doc, localNew, base);
    expect(readDbStructure(doc).columns.map((c) => (c as { id: string }).id)).toEqual(["c1", "c2", "c3"]);
  });
  it("baseline 에 있던 컬럼이 local-new 에 없으면 삭제로 간주해 제거", () => {
    const doc = new Y.Doc(); seedDbStructure(doc, base);
    const localNew = { ...base, columns: [base.columns[0]] };
    reconcileStructureIntoYDoc(doc, localNew, base);
    expect(readDbStructure(doc).columns.map((c) => (c as { id: string }).id)).toEqual(["c1"]);
  });
  it("Y 에만 있고 baseline·local 둘 다 없으면 원격 신규로 보고 유지(레이스 보호)", () => {
    const doc = new Y.Doc(); seedDbStructure(doc, base);
    const cols = doc.getMap(DB_ROOT_KEY).get("columns") as Y.Array<Y.Map<unknown>>;
    const m = new Y.Map<unknown>(); m.set("id", "c9"); m.set("name", "원격"); m.set("type", "text"); cols.push([m]);
    const localNew = { ...base, columns: [...base.columns, { id: "c3", name: "로컬", type: "text" }] };
    reconcileStructureIntoYDoc(doc, localNew, base);
    const ids = readDbStructure(doc).columns.map((c) => (c as { id: string }).id);
    expect(ids).toContain("c9");
    expect(ids).toContain("c3");
  });
  it("panelState 필드 병합·rowPageOrder 교체", () => {
    const doc = new Y.Doc(); seedDbStructure(doc, base);
    const localNew = { ...base, panelState: { sort: { columnId: "c2", dir: "desc" } }, rowPageOrder: ["p1", "p2"] };
    reconcileStructureIntoYDoc(doc, localNew, base);
    const out = readDbStructure(doc);
    expect(out.panelState).toEqual({ sort: { columnId: "c2", dir: "desc" } });
    expect(out.rowPageOrder).toEqual(["p1", "p2"]);
  });
});

const EMPTY = { columns: [], presets: [], panelState: {}, rowPageOrder: [], rows: {}, rowMembers: [] };

describe("rowMembers 집합 reconcile", () => {
  it("로컬 추가 행이 rowMembers 에 들어간다", () => {
    const doc = new Y.Doc();
    seedDbStructure(doc, { ...EMPTY, rowPageOrder: ["a"], rowMembers: ["a"] });
    const baseline = { ...EMPTY, rowPageOrder: ["a"], rowMembers: ["a"] };
    reconcileStructureIntoYDoc(doc, { ...EMPTY, rowPageOrder: ["a", "b"], rowMembers: ["a", "b"] }, baseline);
    expect(readDbStructure(doc).rowMembers).toEqual(["a", "b"]);
  });

  it("로컬 삭제 행이 rowMembers 에서 제거된다(삭제 승)", () => {
    const doc = new Y.Doc();
    seedDbStructure(doc, { ...EMPTY, rowPageOrder: ["a", "b"], rowMembers: ["a", "b"] });
    const baseline = { ...EMPTY, rowPageOrder: ["a", "b"], rowMembers: ["a", "b"] };
    reconcileStructureIntoYDoc(doc, { ...EMPTY, rowPageOrder: ["a"], rowMembers: ["a"] }, baseline);
    expect(readDbStructure(doc).rowMembers).toEqual(["a"]);
  });

  it("baseline 에 없는 원격 신규 멤버는 로컬에 없어도 유지된다(동시 추가 보호)", () => {
    const doc = new Y.Doc();
    seedDbStructure(doc, { ...EMPTY, rowPageOrder: ["a", "r"], rowMembers: ["a", "r"] });
    const baseline = { ...EMPTY, rowPageOrder: ["a"], rowMembers: ["a"] };
    reconcileStructureIntoYDoc(doc, { ...EMPTY, rowPageOrder: ["a", "b"], rowMembers: ["a", "b"] }, baseline);
    const m = readDbStructure(doc).rowMembers;
    expect(new Set(m)).toEqual(new Set(["a", "r", "b"]));
  });

  it("두 doc 동시 추가가 둘 다 수렴한다", () => {
    const a = new Y.Doc();
    seedDbStructure(a, { ...EMPTY, rowPageOrder: ["x"], rowMembers: ["x"] });
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const baseSt = { ...EMPTY, rowPageOrder: ["x"], rowMembers: ["x"] };
    reconcileStructureIntoYDoc(a, { ...EMPTY, rowPageOrder: ["x", "a1"], rowMembers: ["x", "a1"] }, baseSt);
    reconcileStructureIntoYDoc(b, { ...EMPTY, rowPageOrder: ["x", "b1"], rowMembers: ["x", "b1"] }, baseSt);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(new Set(readDbStructure(a).rowMembers)).toEqual(new Set(["x", "a1", "b1"]));
    expect(readDbStructure(a).rowMembers).toEqual(readDbStructure(b).rowMembers);
  });
});
