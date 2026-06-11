import { describe, it, expect, vi, afterEach } from "vitest";
import * as Y from "yjs";
import { registerDbCollab, unregisterDbCollab } from "../../lib/collab/dbCollabRegistry";
import { seedDbStructure, readDbStructure } from "../../lib/collab/dbBundleYjs";

vi.mock("../../lib/sync/runtime", () => ({ enqueueAsync: vi.fn() }));

const EMPTY = { columns: [], presets: [], panelState: {}, rowPageOrder: [], rows: {} };
afterEach(() => unregisterDbCollab("db1"));

describe("seedCollabRowsFromStore", () => {
  it("Y rows 가 비어 있으면 로컬 행 셀로 보충한다", async () => {
    const { useDatabaseStore } = await import("../databaseStore");
    const { usePageStore } = await import("../pageStore");
    usePageStore.setState({
      pages: {
        pg1: { id: "pg1", workspaceId: "ws1", title: "행", icon: null,
          doc: { type: "doc", content: [] }, contentLoaded: true, parentId: null,
          order: 1, databaseId: "db1", dbCells: { c1: "local" }, createdAt: 0, updatedAt: 0 } as never,
      },
    });
    useDatabaseStore.setState({
      databases: {
        db1: { meta: { id: "db1", workspaceId: "ws1", title: "DB", createdAt: 0, updatedAt: 0 },
          columns: [], presets: [], panelState: {}, rowPageOrder: ["pg1"] } as never,
      },
    });
    const doc = new Y.Doc(); seedDbStructure(doc, EMPTY);
    registerDbCollab("db1", { doc, baseline: { ...EMPTY } });

    useDatabaseStore.getState().seedCollabRowsFromStore("db1");
    expect(readDbStructure(doc).rows).toEqual({ pg1: { c1: "local" } });
  });

  it("Y rows 에 이미 값이 있으면 보충하지 않는다(서버 시드 우선)", async () => {
    const { useDatabaseStore } = await import("../databaseStore");
    const { usePageStore } = await import("../pageStore");
    usePageStore.setState({
      pages: {
        pg1: { id: "pg1", workspaceId: "ws1", title: "행", icon: null,
          doc: { type: "doc", content: [] }, contentLoaded: true, parentId: null,
          order: 1, databaseId: "db1", dbCells: { c1: "local" }, createdAt: 0, updatedAt: 0 } as never,
      },
    });
    useDatabaseStore.setState({
      databases: {
        db1: { meta: { id: "db1", workspaceId: "ws1", title: "DB", createdAt: 0, updatedAt: 0 },
          columns: [], presets: [], panelState: {}, rowPageOrder: ["pg1"] } as never,
      },
    });
    const doc = new Y.Doc();
    seedDbStructure(doc, { ...EMPTY, rows: { pg1: { c1: "server" } } });
    registerDbCollab("db1", { doc, baseline: { ...EMPTY } });

    useDatabaseStore.getState().seedCollabRowsFromStore("db1");
    expect(readDbStructure(doc).rows).toEqual({ pg1: { c1: "server" } });
  });
});
