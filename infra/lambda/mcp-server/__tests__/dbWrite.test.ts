import { beforeEach, describe, expect, it, vi } from "vitest";
import { stateToDocJson } from "../../_shared/collabContent";
import { createDatabaseTool } from "../tools/createDatabase";
import { duplicatePageTool } from "../tools/duplicatePage";
import { movePagesTool } from "../tools/movePages";
import { trashPageTool } from "../tools/trashPage";
import { updateDatabaseTool } from "../tools/updateDatabase";
import { updatePageTool } from "../tools/updatePage";
import { broadcastMock, docOf, para, publishMock, resetCollabMocks, rooms, seedRoom } from "./collabMocks";
import { COLUMNS, readDbRoom, row, seedDbRoom, setupDb } from "./dbFixtures";
import type { Item } from "./fakeDdb";

vi.mock("../../realtime/yjsStore", async () => (await import("./collabMocks")).yjsStoreMock);
vi.mock("../wsBroadcast", async () => (await import("./collabMocks")).broadcastMock);
vi.mock("../publish", async () => (await import("./collabMocks")).publishMock);

const HOST = { id: "host", workspaceId: "ws-a", title: "Host", order: "0", parentId: null, updatedAt: "2026-01-01T00:00:00.000Z", doc: JSON.stringify(docOf(para("intro", "b1"))) };
type Fake = ReturnType<typeof setupDb>["fake"];
const dbOf = (fake: Fake, id: string) => fake.tables.databases.find((d) => d.id === id) as Item;
const pageOf = (fake: Fake, id: string) => fake.tables.pages.find((p) => p.id === id) as Item;
const columnsOf = (item: Item) => JSON.parse(String(item.columns)) as { id: string; name: string; type: string; config?: { options?: { id: string; label: string; color: string }[] } }[];

beforeEach(() => resetCollabMocks());

describe("create_database", () => {
  it("inline: title 컬럼 자동 + 옵션 색 순환, 부모 본문 끝에 databaseBlock(룸 경로), 발행", async () => {
    const { ctx, fake } = setupDb({ extraPages: [HOST] });
    seedRoom("v5:host", docOf(para("intro", "b1")));
    const r = await createDatabaseTool(ctx, {
      parent: { pageId: "host" }, title: "Tasks", layout: "inline",
      columns: [{ name: "Stage", type: "status", options: ["Todo", "Doing"] }, { name: "Due", type: "date" }],
    });
    expect(r.title).toBe("Tasks (2)"); // 같은 워크스페이스 "Tasks" 존재
    const db = dbOf(fake, r.databaseId);
    const cols = columnsOf(db);
    expect(cols.map((c) => [c.name, c.type])).toEqual([["이름", "title"], ["Stage", "status"], ["Due", "date"]]);
    expect(cols[1].config?.options?.map((o) => [o.label, o.color])).toEqual([["Todo", "#64748b"], ["Doing", "#2563eb"]]);
    expect(db.panelState).toBeUndefined(); // 앱 신규 DB 와 같이 panelState 미전송
    expect(db.presets).toBe("[]");
    const blocks = stateToDocJson(rooms.get("v5:host")!).content ?? [];
    expect(blocks[1]).toMatchObject({ type: "databaseBlock", attrs: { databaseId: r.databaseId, layout: "inline", view: "table", readOnlyTitle: false } });
    expect(publishMock.publishDatabase).toHaveBeenCalledWith(expect.objectContaining({ id: r.databaseId }));
    expect(fake.tables.pages.filter((p) => p.databaseId === r.databaseId)).toHaveLength(0); // 시드 행 없음
  });

  it("fullPage: 숨김 홈(fullPageDatabaseId·루트·fullPage 블록) + 부모에 DB 버튼", async () => {
    const { ctx, fake } = setupDb({ extraPages: [HOST] });
    const r = await createDatabaseTool(ctx, { parent: { pageId: "host" }, title: "Roadmap", layout: "fullPage" });
    const home = pageOf(fake, String(r.homePageId));
    expect(home).toMatchObject({ title: "Roadmap", fullPageDatabaseId: r.databaseId, parentId: null });
    expect(JSON.parse(String(home.doc)).content).toEqual([
      expect.objectContaining({ type: "databaseBlock", attrs: expect.objectContaining({ databaseId: r.databaseId, layout: "fullPage" }) }),
    ]);
    const blocks = stateToDocJson(rooms.get("v5:host")!).content ?? [];
    expect(blocks.at(-1)?.content?.[0]).toMatchObject({ type: "buttonBlock", attrs: { label: "Roadmap DB", databaseId: r.databaseId } });
  });

  it("옵션 생략 시 앱 기본 옵션(status 4종 색 포함·select 옵션 1/2), date 는 dateShowEnd", async () => {
    const { ctx, fake } = setupDb({ extraPages: [HOST] });
    const r = await createDatabaseTool(ctx, {
      parent: { workspaceId: "ws-a" }, title: "Defaults", layout: "fullPage",
      columns: [{ name: "S", type: "status" }, { name: "Sel", type: "select" }, { name: "D", type: "date" }],
    });
    const cols = columnsOf(dbOf(fake, r.databaseId));
    expect(cols[1].config?.options?.map((o) => [o.label, o.color])).toEqual([["시작전", "#94a3b8"], ["진행중", "#3b82f6"], ["완료", "#10b981"], ["보류", "#f59e0b"]]);
    expect(cols[2].config?.options?.map((o) => o.label)).toEqual(["옵션 1", "옵션 2"]);
    expect(cols[3].config).toEqual({ dateShowEnd: true });
  });

  it("검증: inline 은 페이지 부모 필수, 중복 컬럼명·옵션 없는 타입의 options 거부", async () => {
    const { ctx } = setupDb({ extraPages: [HOST] });
    await expect(createDatabaseTool(ctx, { parent: { workspaceId: "ws-a" }, title: "x", layout: "inline" })).rejects.toThrow(/parent.pageId/);
    await expect(createDatabaseTool(ctx, { parent: { pageId: "host" }, title: "x", columns: [{ name: "이름", type: "text" }] }))
      .rejects.toThrow(/used more than once/);
    await expect(createDatabaseTool(ctx, { parent: { pageId: "host" }, title: "x", columns: [{ name: "A", type: "text", options: ["a"] }] }))
      .rejects.toThrow(/options are only allowed/);
  });
});

describe("update_database", () => {
  it("시드된 룸: 컬럼 추가·이름/타입/옵션 변경·삭제를 클라 구조로 반영하고, 삭제 전 DB 체크포인트", async () => {
    const { ctx, fake } = setupDb();
    seedDbRoom("db1", { columns: COLUMNS, rows: { r1: { "c-note": "x" } }, order: ["r1"] });
    fake.tables["database-history"] = [{ databaseId: "db1", historyId: "2026-01-01#x", workspaceId: "ws-a", kind: "database.session", snapshot: {} }];
    const r = await updateDatabaseTool(ctx, {
      databaseId: "db1",
      addColumns: [{ name: "Priority", type: "select", options: ["P0"] }],
      updateColumns: [
        { column: "Note", name: "Memo", type: "url" },
        { column: "Status", addOptions: ["Blocked"], renameOptions: [{ from: "Todo", to: "To do" }] },
        { column: "Name", name: "Title" },
      ],
      removeColumns: ["Points"],
    });
    expect(r).toMatchObject({ structureWrittenTo: "collab", historyCheckpoint: true });
    const roomCols = readDbRoom("db1").columns as { id: string; name: string; type: string; config?: { options: { label: string }[] } }[];
    expect(roomCols.map((c) => c.name)).toEqual(["Title", "Status", "Tags", "Due", "Owner", "Done?", "Memo", "Priority"]);
    expect(roomCols.find((c) => c.name === "Memo")?.type).toBe("url");
    expect(roomCols.find((c) => c.name === "Status")?.config?.options.map((o) => o.label)).toEqual(["To do", "Done", "Blocked"]);
    expect(columnsOf(dbOf(fake, "db1")).map((c) => c.name)).toEqual(roomCols.map((c) => c.name));
    const checkpoint = fake.tables["database-history"].find((h) => h.kind === "database.checkpoint") as Item;
    expect(JSON.stringify(checkpoint.snapshot)).toContain("Points");
    expect(broadcastMock.broadcastRoomUpdate).toHaveBeenCalledWith("db:v5:db1", expect.any(Uint8Array));
  });

  it("title 컬럼 삭제·타입 변경, 미지 옵션 이름 변경, 중복 이름은 거부", async () => {
    const { ctx } = setupDb();
    await expect(updateDatabaseTool(ctx, { databaseId: "db1", removeColumns: ["Name"] })).rejects.toThrow(/title column/);
    await expect(updateDatabaseTool(ctx, { databaseId: "db1", updateColumns: [{ column: "Name", type: "text" }] })).rejects.toThrow(/title column/);
    await expect(updateDatabaseTool(ctx, { databaseId: "db1", updateColumns: [{ column: "Status", renameOptions: [{ from: "Nope", to: "x" }] }] }))
      .rejects.toThrow(/Valid options: Todo, Done/);
    await expect(updateDatabaseTool(ctx, { databaseId: "db1", addColumns: [{ name: "status", type: "text" }] })).rejects.toThrow(/more than once/);
    await expect(updateDatabaseTool(ctx, { databaseId: "lc-scheduler-db:x", title: "y" })).rejects.toThrow(/scheduler/);
  });

  it("DB 이름 변경은 풀페이지 홈 제목도 맞추고(앱 setDatabaseTitle), 홈 페이지 제목 변경은 DB 이름 변경이 된다", async () => {
    const home = { id: "home", workspaceId: "ws-a", title: "Tasks", fullPageDatabaseId: "db1", parentId: null, order: "0", updatedAt: "2026-01-01T00:00:00.000Z" };
    const { ctx, fake } = setupDb({ extraPages: [home] });
    const r = await updateDatabaseTool(ctx, { databaseId: "db1", title: "Backlog" });
    expect(r).toMatchObject({ title: "Backlog", homePageId: "home" });
    expect(pageOf(fake, "home").title).toBe("Backlog");
    await updatePageTool(ctx, { pageId: "home", title: "Sprint" });
    expect(dbOf(fake, "db1").title).toBe("Sprint");
    expect(pageOf(fake, "home").title).toBe("Sprint");
    await expect(updatePageTool(ctx, { pageId: "home", content: { mode: "append", markdown: "x" } })).rejects.toThrow(/database view/);
  });
});

describe("DB 구조 저장·발행은 룸 값 기준(리뷰 M1)", () => {
  const ROOM_ONLY = { id: "c-room", name: "RoomOnly", type: "text" };
  const publishedColumns = () =>
    (JSON.parse(String((publishMock.publishDatabase.mock.calls.at(-1)?.[0] as Item).columns)) as { name: string }[]).map((c) => c.name);

  it("제목만 바꿔도 룸에만 있는 컬럼이 저장·발행 payload 에 그대로 있다", async () => {
    const { ctx, fake } = setupDb();
    seedDbRoom("db1", { columns: [...COLUMNS, ROOM_ONLY], rows: {}, order: [] });
    await updateDatabaseTool(ctx, { databaseId: "db1", title: "Renamed" });
    expect(publishedColumns()).toContain("RoomOnly");
    expect(columnsOf(dbOf(fake, "db1")).map((c) => c.name)).toContain("RoomOnly");
  });

  it("컬럼 추가도 편집 후 룸 값으로 저장(처음 읽은 current 가 아니라)", async () => {
    const { ctx, fake } = setupDb();
    seedDbRoom("db1", { columns: [...COLUMNS, ROOM_ONLY], rows: {}, order: [] });
    const r = await updateDatabaseTool(ctx, { databaseId: "db1", addColumns: [{ name: "Added", type: "text" }] });
    expect(publishedColumns()).toEqual(expect.arrayContaining(["RoomOnly", "Added"]));
    expect(columnsOf(dbOf(fake, "db1")).map((c) => c.name)).toEqual(expect.arrayContaining(["RoomOnly", "Added"]));
    expect(r.columns.map((c) => c.name)).toEqual(expect.arrayContaining(["RoomOnly", "Added"]));
  });

  it("컬럼 삭제 체크포인트의 rowPageOrder 는 5000행에서 잘리지 않는다(리뷰 L3)", async () => {
    const many = Array.from({ length: 5003 }, (_, i) => row(`x${i}`, `R${i}`, i));
    const { ctx, fake } = setupDb({ rows: many });
    fake.tables["database-history"] = [{ databaseId: "db1", historyId: "2026-01-01#x", workspaceId: "ws-a", kind: "database.session", snapshot: {} }];
    await updateDatabaseTool(ctx, { databaseId: "db1", removeColumns: ["Note"] });
    const checkpoint = fake.tables["database-history"].find((h) => h.kind === "database.checkpoint") as Item;
    expect((checkpoint.snapshot as { rowPageOrder: string[] }).rowPageOrder).toHaveLength(5003);
  });
});

describe("DB 행 휴지통·복제·이동", () => {
  it("trash_page(행): soft delete + 룸 rows·rowMembers·rowPageOrder 에서 제거 + tombstone 발행", async () => {
    const { ctx, fake } = setupDb();
    seedDbRoom("db1", { columns: COLUMNS, rows: { r1: {}, r2: {} }, order: ["r1", "r2"] });
    const r = await trashPageTool(ctx, { pageId: "r1" });
    expect(r).toMatchObject({ trashed: ["r1"], rowRemovedFrom: "collab" });
    expect(pageOf(fake, "r1").deletedAt).toBeTruthy();
    const room = readDbRoom("db1");
    expect(room.rowMembers).toEqual(["r2"]);
    expect(room.rowPageOrder).toEqual(["r2"]);
    expect(Object.keys(room.rows as object)).toEqual(["r2"]);
    expect(publishMock.publishPage).toHaveBeenCalledWith(expect.objectContaining({ id: "r1" }), { deletedAt: expect.any(String) });
  });

  it("duplicate_page(행): 룸 셀 복제·원본 바로 뒤 순서·멤버십, 템플릿 행은 거부", async () => {
    const { ctx, fake } = setupDb({ rows: [row("r1", "Alpha", 1, { "c-pts": 1 }), row("r2", "Beta", 2), row("tpl", "T", 3, { _qn_isTemplate: "1" })] });
    seedDbRoom("db1", { columns: COLUMNS, rows: { r1: { "c-pts": 9 }, r2: {} }, order: ["r1", "r2"] });
    const r = await duplicatePageTool(ctx, { pageId: "r1" });
    const copy = pageOf(fake, r.id);
    expect(copy).toMatchObject({ title: "Alpha (Copy)", databaseId: "db1", order: "1.5" });
    expect(JSON.parse(String(copy.dbCells))).toEqual({ "c-pts": 9 });
    const room = readDbRoom("db1");
    expect(room.rowPageOrder).toEqual(["r1", r.id, "r2"]);
    expect(room.rowMembers).toEqual(["r1", "r2", r.id]);
    expect((room.rows as Record<string, unknown>)[r.id]).toEqual({ "c-pts": 9 });
    await expect(duplicatePageTool(ctx, { pageId: "tpl" })).rejects.toThrow(/templates/);
  });

  it("move_pages 는 DB 행을 계속 거부", async () => {
    const { ctx } = setupDb({ extraPages: [HOST] });
    await expect(movePagesTool(ctx, { pageIds: ["r1"], newParent: { pageId: "host" } })).rejects.toThrow(/database row/);
  });
});
