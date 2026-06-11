import { describe, it, expect, vi, afterEach } from "vitest";
import * as Y from "yjs";
import { registerDbCollab, unregisterDbCollab } from "../../lib/collab/dbCollabRegistry";
import { seedDbStructure, readDbStructure } from "../../lib/collab/dbBundleYjs";

vi.mock("../../lib/sync/runtime", () => ({ enqueueAsync: vi.fn() }));

const EMPTY = { columns: [], presets: [], panelState: {}, rowPageOrder: [], rows: {}, rowMembers: [] };
afterEach(() => unregisterDbCollab("dba"));

describe("addRow 협업 셀 라우팅", () => {
  it("협업 ON: 신규 행의 기본 셀이 Y rows 에 들어가고 inner map 이 생성된다", async () => {
    const { useDatabaseStore } = await import("../databaseStore");
    useDatabaseStore.setState({
      databases: {
        dba: { meta: { id: "dba", workspaceId: "ws1", title: "DB", createdAt: 0, updatedAt: 0 },
          columns: [
            { id: "t", name: "제목", type: "title" },
            { id: "s", name: "상태", type: "status", config: { options: [{ id: "o1", label: "A" }] } },
          ], presets: [], panelState: {}, rowPageOrder: [] } as never,
      },
    });
    const doc = new Y.Doc(); seedDbStructure(doc, EMPTY);
    registerDbCollab("dba", { doc, baseline: { ...EMPTY } });

    const pageId = useDatabaseStore.getState().addRow("dba");
    const rows = readDbStructure(doc).rows;
    expect(rows[pageId]).toBeDefined();
    expect(rows[pageId]?.s).toBe("o1");
  });
});
