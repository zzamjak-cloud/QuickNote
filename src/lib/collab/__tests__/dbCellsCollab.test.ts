import { describe, it, expect, afterEach } from "vitest";
import * as Y from "yjs";
import {
  writeCellsToCollabDoc,
  restoreRowCellsToCollabDoc,
  deleteRowFromCollabDoc,
} from "../dbCellsCollab";
import { readDbStructure, seedDbStructure } from "../dbBundleYjs";
import { registerDbCollab, unregisterDbCollab } from "../dbCollabRegistry";

const EMPTY = { columns: [], presets: [], panelState: {}, rowPageOrder: [], rows: {} };

afterEach(() => unregisterDbCollab("db1"));

describe("deleteRowFromCollabDoc", () => {
  it("핸들이 없으면 false", () => {
    expect(deleteRowFromCollabDoc("nope", "pg1")).toBe(false);
  });

  it("행→일반페이지 전환 시 Y룸 rows 에서 해당 행을 제거한다", () => {
    const doc = new Y.Doc();
    seedDbStructure(doc, EMPTY);
    registerDbCollab("db1", { doc, baseline: { ...EMPTY } });
    writeCellsToCollabDoc("db1", "pg1", { c1: "a" });
    writeCellsToCollabDoc("db1", "pg2", { c1: "b" });
    expect(deleteRowFromCollabDoc("db1", "pg1")).toBe(true);
    expect(readDbStructure(doc).rows).toEqual({ pg2: { c1: "b" } });
  });
});

describe("writeCellsToCollabDoc", () => {
  it("핸들이 없으면 false 를 반환한다", () => {
    expect(writeCellsToCollabDoc("nope", "pg1", { c1: "x" })).toBe(false);
  });

  it("columnId 단위로 셀 값을 set 한다", () => {
    const doc = new Y.Doc();
    seedDbStructure(doc, EMPTY);
    registerDbCollab("db1", { doc, baseline: { ...EMPTY } });
    expect(writeCellsToCollabDoc("db1", "pg1", { c1: "hello", c2: 3 })).toBe(true);
    expect(readDbStructure(doc).rows).toEqual({ pg1: { c1: "hello", c2: 3 } });
  });

  it("value 가 undefined 인 셀은 delete 한다", () => {
    const doc = new Y.Doc();
    seedDbStructure(doc, EMPTY);
    registerDbCollab("db1", { doc, baseline: { ...EMPTY } });
    writeCellsToCollabDoc("db1", "pg1", { c1: "a", c2: "b" });
    writeCellsToCollabDoc("db1", "pg1", { c1: undefined });
    expect(readDbStructure(doc).rows).toEqual({ pg1: { c2: "b" } });
  });

  it("기존(시드된) 행의 다른 셀 동시 편집은 병합된다", () => {
    const a = new Y.Doc();
    seedDbStructure(a, { ...EMPTY, rows: { pg1: { c0: "seed" } } }); // 행 inner map 선시드
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a)); // 양쪽이 동일 inner map 공유
    registerDbCollab("db1", { doc: a, baseline: { ...EMPTY } });
    // a: helper 로 c1, b: 기존 inner map 에 직접 c2 (다른 셀)
    writeCellsToCollabDoc("db1", "pg1", { c1: "from-a" });
    b.transact(() => {
      const rows = b.getMap("db").get("rows") as Y.Map<Y.Map<unknown>>;
      (rows.get("pg1") as Y.Map<unknown>).set("c2", "from-b");
    });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(readDbStructure(a).rows.pg1).toMatchObject({ c0: "seed", c1: "from-a", c2: "from-b" });
    expect(readDbStructure(a).rows).toEqual(readDbStructure(b).rows);
  });

  it("restoreRowCellsToCollabDoc: 복원본과 정확히 일치하도록 기존 셀까지 정리한다", () => {
    const doc = new Y.Doc();
    seedDbStructure(doc, EMPTY);
    registerDbCollab("db1", { doc, baseline: { ...EMPTY } });
    // 현재 상태: c1, c2, c3
    writeCellsToCollabDoc("db1", "pg1", { c1: "a", c2: "b", c3: "c" });
    // 복원본: c1(변경), c2(유지), c3 없음 → c3 는 삭제돼야 한다.
    expect(restoreRowCellsToCollabDoc("db1", "pg1", { c1: "A", c2: "b" })).toBe(true);
    expect(readDbStructure(doc).rows).toEqual({ pg1: { c1: "A", c2: "b" } });
  });

  it("restoreRowCellsToCollabDoc: 핸들 없으면 false", () => {
    expect(restoreRowCellsToCollabDoc("nope", "pg1", { c1: "x" })).toBe(false);
  });

  it("같은 셀 동시 편집은 LWW 로 단일 값에 수렴한다", () => {
    const a = new Y.Doc();
    seedDbStructure(a, { ...EMPTY, rows: { pg1: { c1: "seed" } } });
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    registerDbCollab("db1", { doc: a, baseline: { ...EMPTY } });
    writeCellsToCollabDoc("db1", "pg1", { c1: "from-a" });
    b.transact(() => {
      const rows = b.getMap("db").get("rows") as Y.Map<Y.Map<unknown>>;
      (rows.get("pg1") as Y.Map<unknown>).set("c1", "from-b");
    });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(readDbStructure(a).rows).toEqual(readDbStructure(b).rows); // 수렴
    expect(["from-a", "from-b"]).toContain(readDbStructure(a).rows.pg1.c1); // 단일 값
  });
});
