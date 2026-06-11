import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { registerDbCollab, unregisterDbCollab, getDbCollab, isDbCollabActive } from "../dbCollabRegistry";

describe("dbCollabRegistry", () => {
  it("등록·조회·해제", () => {
    const doc = new Y.Doc();
    const base = { columns: [], presets: [], panelState: {}, rowPageOrder: [] };
    expect(isDbCollabActive("d1")).toBe(false);
    registerDbCollab("d1", { doc, baseline: base });
    expect(isDbCollabActive("d1")).toBe(true);
    expect(getDbCollab("d1")?.doc).toBe(doc);
    unregisterDbCollab("d1");
    expect(isDbCollabActive("d1")).toBe(false);
  });
});
