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
