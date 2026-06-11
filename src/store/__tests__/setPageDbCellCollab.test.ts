import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import { registerDbCollab, unregisterDbCollab } from "../../lib/collab/dbCollabRegistry";
import { seedDbStructure, readDbStructure } from "../../lib/collab/dbBundleYjs";

const enqueueAsync = vi.fn();
vi.mock("../../lib/sync/runtime", () => ({ enqueueAsync: (...a: unknown[]) => enqueueAsync(...a) }));

const EMPTY = { columns: [], presets: [], panelState: {}, rowPageOrder: [], rows: {} };

beforeEach(() => { enqueueAsync.mockClear(); });
afterEach(() => unregisterDbCollab("db1"));

describe("setPageDbCell 협업 라우팅", () => {
  it("협업 활성 행 페이지의 셀은 Y 로 가고 페이지 upsert 는 생략된다", async () => {
    const { usePageStore } = await import("../pageStore");
    usePageStore.setState({
      pages: {
        pg1: {
          id: "pg1", workspaceId: "ws1", title: "행", icon: null,
          doc: { type: "doc", content: [] }, contentLoaded: true,
          parentId: null, order: 1, databaseId: "db1", dbCells: {},
          createdAt: 0, updatedAt: 0,
        } as never,
      },
    });
    const doc = new Y.Doc(); seedDbStructure(doc, EMPTY);
    registerDbCollab("db1", { doc, baseline: { ...EMPTY } });

    usePageStore.getState().setPageDbCell("pg1", "c1", "hello");

    expect(usePageStore.getState().pages.pg1?.dbCells).toEqual({ c1: "hello" });
    expect(readDbStructure(doc).rows).toEqual({ pg1: { c1: "hello" } });
    expect(enqueueAsync).not.toHaveBeenCalledWith("upsertPage", expect.anything());
  });

  it("협업 비활성 행 페이지는 기존대로 페이지 upsert 한다", async () => {
    const { usePageStore } = await import("../pageStore");
    usePageStore.setState({
      pages: {
        pg2: {
          id: "pg2", workspaceId: "ws1", title: "행", icon: null,
          doc: { type: "doc", content: [] }, contentLoaded: true,
          parentId: null, order: 1, databaseId: "dbX", dbCells: {},
          createdAt: 0, updatedAt: 0,
        } as never,
      },
    });
    usePageStore.getState().setPageDbCell("pg2", "c1", "hi");
    expect(enqueueAsync).toHaveBeenCalledWith("upsertPage", expect.objectContaining({ id: "pg2" }));
  });
});
