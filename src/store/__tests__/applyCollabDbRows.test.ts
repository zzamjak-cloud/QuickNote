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
});
