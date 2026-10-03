// M2: 툴 시작 시점 스냅샷으로 전체 Put 하지 않고, 저장 직전 최신 항목에 바꾼 필드만 덮어 updatedAt 조건부로 저장한다.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadBodyBase, writePageBody } from "../collabWriter";
import { movePagesTool } from "../tools/movePages";
import { updatePageTool } from "../tools/updatePage";
import { appended, docOf, para, publishMock, resetCollabMocks, rooms, seedRoom } from "./collabMocks";
import { stateToDocJson } from "../../_shared/collabContent";
import { baseTables, makeCtx } from "./fixtures";
import type { Item } from "./fakeDdb";

vi.mock("../../realtime/yjsStore", async () => (await import("./collabMocks")).yjsStoreMock);
vi.mock("../wsBroadcast", async () => (await import("./collabMocks")).broadcastMock);
vi.mock("../../template-automation/runner", async () => (await import("./collabMocks")).publishMock);

const COLUMNS = [
  { id: "c-title", name: "Name", type: "title" },
  { id: "c-status", name: "Status", type: "status", config: { options: [{ id: "o-todo", label: "Todo" }] } },
];

function setup() {
  const tables = baseTables();
  tables.pages = [
    { id: "p1", workspaceId: "ws-a", title: "Old", order: "0", updatedAt: "2026-01-01T00:00:00.000Z", doc: JSON.stringify(docOf(para("a"))) },
    { id: "parent", workspaceId: "ws-a", title: "Parent", order: "1", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "row", workspaceId: "ws-a", title: "Row", databaseId: "db1", order: "0", updatedAt: "2026-01-01T00:00:00.000Z", dbCells: JSON.stringify({ "c-pts": 1 }) },
  ];
  tables.databases = [{ id: "db1", workspaceId: "ws-a", title: "Tasks", columns: JSON.stringify(COLUMNS) }];
  return makeCtx(tables, { scopes: ["read", "write"] });
}

type Fake = ReturnType<typeof setup>["fake"];
const pageOf = (fake: Fake, id: string) => fake.tables.pages.find((p) => p.id === id) as Item;

/** 첫 Pages Put 직전에 다른 사용자의 저장을 끼워 넣는다(updatedAt 이 바뀌어 조건부 Put 이 실패). */
function interleave(fake: Fake, id: string, change: Item, times = 1) {
  const send = fake.doc.send.bind(fake.doc);
  let remaining = times;
  fake.doc.send = (async (cmd: { constructor: { name: string }; input: Item }) => {
    if (remaining > 0 && cmd.constructor.name === "PutCommand" && cmd.input.TableName === "pages" && (cmd.input.Item as Item).id === id) {
      remaining -= 1;
      Object.assign(pageOf(fake, id), change, { updatedAt: `2026-05-0${remaining + 1}T00:00:00.000Z` });
    }
    return send(cmd as never);
  }) as typeof fake.doc.send;
}

beforeEach(() => resetCollabMocks());

describe("부분 갱신·조건부 저장", () => {
  it("본문 쓰기는 낡은 스냅샷이 아니라 최신 항목 위에 doc 만 덮는다", async () => {
    const { ctx, fake } = setup();
    const stale = { ...pageOf(fake, "p1") };
    Object.assign(pageOf(fake, "p1"), { title: "New by user", icon: "⭐", parentId: "parent" });
    seedRoom("v5:p1", docOf(para("a")));
    const base = await loadBodyBase(ctx, stale);
    await writePageBody(ctx, stale, base, { kind: "insert", blocks: [para("b")], at: "end" });
    expect(pageOf(fake, "p1")).toMatchObject({ title: "New by user", icon: "⭐", parentId: "parent" });
    expect(String(pageOf(fake, "p1").doc)).toContain('"b"');
  });

  it("저장 중 다른 편집이 끼면 1회 재시도해 그 변경을 보존한다(move)", async () => {
    const { ctx, fake } = setup();
    interleave(fake, "p1", { title: "Renamed meanwhile" });
    await movePagesTool(ctx, { pageIds: ["p1"], newParent: { pageId: "parent" } });
    expect(pageOf(fake, "p1")).toMatchObject({ title: "Renamed meanwhile", parentId: "parent" });
  });

  it("셀 갱신은 최신 dbCells 에 병합(그 사이 다른 셀 편집 보존)", async () => {
    const { ctx, fake } = setup();
    interleave(fake, "row", { dbCells: JSON.stringify({ "c-pts": 9 }) });
    await updatePageTool(ctx, { pageId: "row", properties: { Status: "Todo" } });
    expect(JSON.parse(String(pageOf(fake, "row").dbCells))).toEqual({ "c-pts": 9, "c-status": "o-todo" });
  });


  it("룸 반영 뒤 materialize 가 연속 Conflict 여도 성공(materialized:false)·update 는 1회만 append·publish 생략", async () => {
    const { ctx, fake } = setup();
    seedRoom("v5:p1", docOf(para("a")));
    interleave(fake, "p1", { title: "busy client" }, 2);
    const r = await updatePageTool(ctx, { pageId: "p1", content: { mode: "append", markdown: "added once" } });
    expect(r).toMatchObject({ contentChanged: true, materialized: false });
    expect(appended).toHaveLength(1);
    expect(publishMock.publishPageChangedToAppSync).not.toHaveBeenCalled();
    const texts = (stateToDocJson(rooms.get("v5:p1")!).content ?? []).map((b) => b.content?.[0]?.text);
    expect(texts).toEqual(["a", "added once"]);
  });

  it("룸 반영 뒤 Conflict 가 아닌 저장 오류도 성공으로 돌려준다(오류 로그)", async () => {
    const { ctx, fake } = setup();
    seedRoom("v5:p1", docOf(para("a")));
    const send = fake.doc.send.bind(fake.doc);
    fake.doc.send = (async (cmd: { constructor: { name: string }; input: Item }) => {
      if (cmd.constructor.name === "PutCommand" && cmd.input.TableName === "pages") throw new Error("throttled");
      return send(cmd as never);
    }) as typeof fake.doc.send;
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await updatePageTool(ctx, { pageId: "p1", content: { mode: "append", markdown: "x" } });
    expect(r).toMatchObject({ contentChanged: true, materialized: false });
    expect(appended).toHaveLength(1);
    expect(errorLog).toHaveBeenCalledWith("mcp materialize 생략(룸 반영 완료)", expect.objectContaining({ conflict: false }), expect.any(Error));
    errorLog.mockRestore();
  });

  it("룸 반영 전 실패(메타만 갱신)는 그대로 오류", async () => {
    const { ctx, fake } = setup();
    interleave(fake, "p1", { title: "x" }, 2);
    await expect(updatePageTool(ctx, { pageId: "p1", title: "Mine" })).rejects.toThrow(/modified concurrently/);
  });
});
