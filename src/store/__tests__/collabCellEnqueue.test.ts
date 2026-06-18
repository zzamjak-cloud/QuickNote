import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import { registerDbCollab, unregisterDbCollab } from "../../lib/collab/dbCollabRegistry";
import { seedDbStructure } from "../../lib/collab/dbBundleYjs";

const enqueueAsync = vi.fn();
vi.mock("../../lib/sync/runtime", () => ({ enqueueAsync: (...a: unknown[]) => enqueueAsync(...a) }));

const EMPTY = { columns: [], presets: [], panelState: {}, rowPageOrder: [], rows: {} };

beforeEach(() => { enqueueAsync.mockClear(); });
afterEach(() => unregisterDbCollab("db1"));

function makePage(over: Record<string, unknown> = {}) {
  return {
    id: "pg1", workspaceId: "ws1", title: "행", icon: null, doc: { type: "doc", content: [] },
    parentId: null, order: 1, databaseId: "db1",
    dbCells: { c1: "v" }, createdAt: 0, updatedAt: 0, ...over,
  } as never;
}

describe("협업 ON DB 행 페이지 upsert 의 dbCells 제외", () => {
  it("enqueueUpsertPageRaw: 협업 활성이면 dbCells 를 null 로 보낸다", async () => {
    const { enqueueUpsertPageRaw } = await import("../databaseStore/helpers");
    const doc = new Y.Doc(); seedDbStructure(doc, EMPTY);
    registerDbCollab("db1", { doc, baseline: { ...EMPTY } });
    enqueueUpsertPageRaw(makePage());
    expect(enqueueAsync).toHaveBeenCalledWith("upsertPage", expect.objectContaining({ dbCells: null }));
  });

  it("enqueueUpsertPageRaw: includeCells 면 dbCells 를 보낸다", async () => {
    const { enqueueUpsertPageRaw } = await import("../databaseStore/helpers");
    const doc = new Y.Doc(); seedDbStructure(doc, EMPTY);
    registerDbCollab("db1", { doc, baseline: { ...EMPTY } });
    enqueueUpsertPageRaw(makePage(), { includeCells: true });
    expect(enqueueAsync).toHaveBeenCalledWith("upsertPage", expect.objectContaining({ dbCells: JSON.stringify({ c1: "v" }) }));
  });

  it("enqueueUpsertPageRaw: 협업 비활성이면 dbCells 를 그대로 보낸다", async () => {
    const { enqueueUpsertPageRaw } = await import("../databaseStore/helpers");
    enqueueUpsertPageRaw(makePage());
    expect(enqueueAsync).toHaveBeenCalledWith("upsertPage", expect.objectContaining({ dbCells: JSON.stringify({ c1: "v" }) }));
  });

  it("enqueueUpsertPage cellsOnly: 협업 활성이어도 실제 dbCells 를 보내고 doc 은 생략한다", async () => {
    const { enqueueUpsertPage } = await import("../pageStore/helpers");
    const doc = new Y.Doc(); seedDbStructure(doc, EMPTY);
    registerDbCollab("db1", { doc, baseline: { ...EMPTY } });
    enqueueUpsertPage(makePage(), { cellsOnly: true });
    const call = enqueueAsync.mock.calls.find((c) => c[0] === "upsertPage");
    expect(call).toBeTruthy();
    const payload = call![1] as Record<string, unknown>;
    // 셀은 실제 값으로 영속(히스토리/durable mirror), 본문(doc)은 서버 백스톱이 보존하도록 생략.
    expect(payload.dbCells).toBe(JSON.stringify({ c1: "v" }));
    expect("doc" in payload).toBe(false);
  });
});
