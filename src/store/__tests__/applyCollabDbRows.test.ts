import { describe, it, expect, vi, beforeEach } from "vitest";

const enqueueAsync = vi.fn();
vi.mock("../../lib/sync/runtime", () => ({ enqueueAsync: (...a: unknown[]) => enqueueAsync(...a) }));

beforeEach(() => { enqueueAsync.mockClear(); });

describe("applyCollabDbStructure rows materialize", () => {
  it("Y rows 를 존재하는 행 페이지 dbCells 로 반영하고 includeCells 로 영속한다", async () => {
    const { useDatabaseStore } = await import("../databaseStore");
    const { usePageStore } = await import("../pageStore");

    usePageStore.setState({
      pages: {
        pg1: { id: "pg1", workspaceId: "ws1", title: "행1", icon: null,
          doc: { type: "doc", content: [] }, contentLoaded: true, parentId: null,
          order: 1, databaseId: "db1", dbCells: { c1: "old" }, createdAt: 0, updatedAt: 0 } as never,
      },
    });
    useDatabaseStore.setState({
      databases: {
        db1: {
          meta: { id: "db1", workspaceId: "ws1", title: "DB", createdAt: 0, updatedAt: 0 },
          columns: [], presets: [], panelState: {}, rowPageOrder: ["pg1"],
        } as never,
      },
    });

    useDatabaseStore.getState().applyCollabDbStructure("db1", {
      columns: [], presets: [], panelState: {}, rowPageOrder: ["pg1"],
      rows: { pg1: { c1: "new" }, ghost: { c1: "x" } }, // ghost 는 페이지 없음 → 무시
    });

    expect(usePageStore.getState().pages.pg1?.dbCells).toEqual({ c1: "new" });
    expect(enqueueAsync).toHaveBeenCalledWith(
      "upsertPage",
      expect.objectContaining({ id: "pg1", dbCells: JSON.stringify({ c1: "new" }) }),
    );
    expect(enqueueAsync).not.toHaveBeenCalledWith("upsertPage", expect.objectContaining({ id: "ghost" }));
  });

  it("dbCells 가 동일하면 행 페이지 upsert 를 발생시키지 않는다", async () => {
    const { useDatabaseStore } = await import("../databaseStore");
    const { usePageStore } = await import("../pageStore");
    usePageStore.setState({
      pages: {
        pg9: { id: "pg9", workspaceId: "ws1", title: "행", icon: null,
          doc: { type: "doc", content: [] }, contentLoaded: true, parentId: null,
          order: 1, databaseId: "db9", dbCells: { c1: "same" }, createdAt: 0, updatedAt: 0 } as never,
      },
    });
    useDatabaseStore.setState({
      databases: {
        db9: { meta: { id: "db9", workspaceId: "ws1", title: "DB", createdAt: 0, updatedAt: 0 },
          columns: [], presets: [], panelState: {}, rowPageOrder: ["pg9"] } as never,
      },
    });
    enqueueAsync.mockClear();
    useDatabaseStore.getState().applyCollabDbStructure("db9", {
      columns: [], presets: [], panelState: {}, rowPageOrder: ["pg9"],
      rows: { pg9: { c1: "same" } },
    });
    expect(enqueueAsync).not.toHaveBeenCalledWith("upsertPage", expect.objectContaining({ id: "pg9" }));
  });

  it("finalOrder = 순서∩멤버 ++ 누락 멤버 append, 비멤버는 제외한다", async () => {
    const { useDatabaseStore } = await import("../databaseStore");
    const { usePageStore } = await import("../pageStore");
    usePageStore.setState({
      pages: {
        p1: { id: "p1", workspaceId: "ws1", title: "1", icon: null, doc: { type: "doc", content: [] },
          contentLoaded: true, parentId: null, order: 1, databaseId: "dbm", dbCells: {}, createdAt: 0, updatedAt: 0 } as never,
        p2: { id: "p2", workspaceId: "ws1", title: "2", icon: null, doc: { type: "doc", content: [] },
          contentLoaded: true, parentId: null, order: 2, databaseId: "dbm", dbCells: {}, createdAt: 0, updatedAt: 0 } as never,
        p3: { id: "p3", workspaceId: "ws1", title: "3", icon: null, doc: { type: "doc", content: [] },
          contentLoaded: true, parentId: null, order: 3, databaseId: "dbm", dbCells: {}, createdAt: 0, updatedAt: 0 } as never,
      },
    });
    useDatabaseStore.setState({
      databases: {
        dbm: { meta: { id: "dbm", workspaceId: "ws1", title: "DB", createdAt: 0, updatedAt: 0 },
          columns: [], presets: [], panelState: {}, rowPageOrder: ["p1"] } as never,
      },
    });
    useDatabaseStore.getState().applyCollabDbStructure("dbm", {
      columns: [], presets: [], panelState: {}, rowPageOrder: ["p2", "p1"],
      rows: {}, rowMembers: ["p1", "p2", "p3"],
    } as never);
    expect(useDatabaseStore.getState().databases.dbm?.rowPageOrder).toEqual(["p2", "p1", "p3"]);
  });

  it("rowMembers 가 비면(구버전) rowPageOrder 를 그대로 쓴다", async () => {
    const { useDatabaseStore } = await import("../databaseStore");
    useDatabaseStore.setState({
      databases: {
        dbo: { meta: { id: "dbo", workspaceId: "ws1", title: "DB", createdAt: 0, updatedAt: 0 },
          columns: [], presets: [], panelState: {}, rowPageOrder: ["a"] } as never,
      },
    });
    useDatabaseStore.getState().applyCollabDbStructure("dbo", {
      columns: [], presets: [], panelState: {}, rowPageOrder: ["a", "b"], rows: {}, rowMembers: [],
    } as never);
    expect(useDatabaseStore.getState().databases.dbo?.rowPageOrder).toEqual(["a", "b"]);
  });

  it("비멤버 행의 rows 셀은 materialize 하지 않는다(삭제 승)", async () => {
    const { useDatabaseStore } = await import("../databaseStore");
    const { usePageStore } = await import("../pageStore");
    usePageStore.setState({
      pages: {
        keep: { id: "keep", workspaceId: "ws1", title: "k", icon: null, doc: { type: "doc", content: [] },
          contentLoaded: true, parentId: null, order: 1, databaseId: "dbd", dbCells: {}, createdAt: 0, updatedAt: 0 } as never,
        gone: { id: "gone", workspaceId: "ws1", title: "g", icon: null, doc: { type: "doc", content: [] },
          contentLoaded: true, parentId: null, order: 2, databaseId: "dbd", dbCells: { c1: "old" }, createdAt: 0, updatedAt: 0 } as never,
      },
    });
    useDatabaseStore.setState({
      databases: {
        dbd: { meta: { id: "dbd", workspaceId: "ws1", title: "DB", createdAt: 0, updatedAt: 0 },
          columns: [], presets: [], panelState: {}, rowPageOrder: ["keep", "gone"] } as never,
      },
    });
    useDatabaseStore.getState().applyCollabDbStructure("dbd", {
      columns: [], presets: [], panelState: {}, rowPageOrder: ["keep"],
      rows: { keep: { c1: "x" }, gone: { c1: "new" } }, rowMembers: ["keep"],
    } as never);
    expect(useDatabaseStore.getState().databases.dbd?.rowPageOrder).toEqual(["keep"]);
    expect(usePageStore.getState().pages.gone?.dbCells).toEqual({ c1: "old" });
    expect(usePageStore.getState().pages.keep?.dbCells).toEqual({ c1: "x" });
  });
});
