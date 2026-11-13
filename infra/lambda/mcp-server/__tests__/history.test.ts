import { beforeEach, describe, expect, it, vi } from "vitest";
import { stateToDocJson } from "../../_shared/collabContent";
import { NOT_ACCESSIBLE } from "../access";
import { listDatabaseHistoryTool, listDatabaseRowHistoryTool, restoreDatabaseVersionTool } from "../tools/history/databaseHistory";
import { listPageHistoryTool, restorePageVersionTool, savePageVersionTool, VERSION_NOT_FOUND } from "../tools/history/pageHistory";
import { emptyTrashTool, permanentlyDeleteDatabaseTool, permanentlyDeletePageTool } from "../tools/history/permanentDelete";
import { CONFIRM_REQUIRED } from "../tools/history/shared";
import { listTrashTool, restoreDatabaseTool, restorePageTool, trashDatabaseTool } from "../tools/history/trash";
import { trashPageTool } from "../tools/trashPage";
import { EDIT_ACCESS_ERROR, READ_ONLY_POLICY_ERROR, WRITE_SCOPE_ERROR } from "../writeAccess";
import { appended, broadcastMock, docOf, para, publishMock, resetCollabMocks, rooms, seedRoom } from "./collabMocks";
import { COLUMNS, readDbRoom, row, seedDbRoom, setupDb } from "./dbFixtures";
import type { Item } from "./fakeDdb";
import { baseTables, makeCtx } from "./fixtures";

vi.mock("../../realtime/yjsStore", async () => (await import("./collabMocks")).yjsStoreMock);
vi.mock("../wsBroadcast", async () => (await import("./collabMocks")).broadcastMock);
vi.mock("../publish", async () => (await import("./collabMocks")).publishMock);

const WRITE = { scopes: ["read", "write"] as ("read" | "write")[] };
const READ = { scopes: ["read"] as ("read" | "write")[] };
const ROOM = "v5:p1";
const T0 = "2026-01-01T00:00:00.000Z";

function page(id: string, extra: Item = {}): Item {
  return { id, workspaceId: "ws-a", title: id, order: "0", parentId: null, createdAt: T0, updatedAt: T0, doc: JSON.stringify(docOf(para(`body ${id}`))), ...extra };
}

function historyEntry(pageId: string, historyId: string, snapshot: Item, extra: Item = {}): Item {
  return {
    pageId, historyId, workspaceId: "ws-a", kind: "page.session", snapshot, createdAt: historyId.slice(0, 24),
    sessionStartedAt: historyId.slice(0, 24), lastActivityAt: historyId.slice(0, 24),
    createdByMemberId: "m2", createdByName: "Bob", contributors: [{ memberId: "m2", name: "Bob" }], changedUnits: ["block:b1"], ...extra,
  };
}

function setupPages(pages: Item[], token: object = WRITE, mutate?: (t: Record<string, Item[]>) => void) {
  const tables = baseTables();
  tables.pages = pages.map((p) => ({ ...p }));
  mutate?.(tables);
  return makeCtx(tables, token as never);
}

function roomTexts(room = ROOM): string[] {
  return (stateToDocJson(rooms.get(room) ?? new Uint8Array()).content ?? []).map((b) => b.content?.[0]?.text ?? "");
}

/** 일일 쓰기 카운터(ADD cnt)에 소비된 units 합계. */
function chargedUnits(fake: { calls: { constructor: { name: string }; input: Item }[] }): number {
  return fake.calls
    .filter((c) => c.constructor.name === "UpdateCommand" && c.input.TableName === "ai-usage")
    .reduce((n, c) => n + Number((c.input.ExpressionAttributeValues as Item)[":inc"] ?? 0), 0);
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

beforeEach(() => resetCollabMocks());

describe("페이지 버전 히스토리", () => {
  const OLD = docOf(para("Old body", "b1"));
  const CURRENT = docOf(para("Current body", "b1"), para("Extra", "b2"));

  function setupWithHistory(token: object = WRITE, pageExtra: Item = {}) {
    const ctx = setupPages([page("p1", { doc: JSON.stringify(CURRENT), ...pageExtra })], token, (t) => {
      t["page-history"] = [
        historyEntry("p1", "2026-01-01T00:00:00.000Z#a", { id: "p1", workspaceId: "ws-a", title: "Old title", doc: JSON.stringify(OLD) }),
        historyEntry("p1", "2026-01-02T00:00:00.000Z#b", { id: "p1", workspaceId: "ws-a", title: "p1", doc: JSON.stringify(CURRENT) }),
      ];
    });
    return ctx;
  }

  it("list_page_history: 최신순 요약(스냅샷 본문 제외)", async () => {
    const { ctx } = setupWithHistory(READ);
    const r = await listPageHistoryTool(ctx, { pageId: "p1" });
    expect(r.versions.map((v) => v.historyId)).toEqual(["2026-01-02T00:00:00.000Z#b", "2026-01-01T00:00:00.000Z#a"]);
    expect(r.versions[1]).toMatchObject({ title: "Old title", editedBy: "Bob", contributors: ["Bob"], changedUnits: 1 });
    expect(JSON.stringify(r)).not.toContain("Old body");
  });

  it("list_page_history: 접근 불가 워크스페이스는 존재를 숨긴다", async () => {
    const { ctx } = setupPages([page("px", { workspaceId: "ws-c" })], READ);
    await expect(listPageHistoryTool(ctx, { pageId: "px" })).rejects.toThrow(NOT_ACCESSIBLE);
  });

  it("restore_page_version: 현재 룸 본문 체크포인트 → Pages 복원 → 룸 replace·브로드캐스트·발행", async () => {
    const { ctx, fake } = setupWithHistory();
    seedRoom(ROOM, CURRENT);
    const r = await restorePageVersionTool(ctx, { pageId: "p1", historyId: "2026-01-01T00:00:00.000Z#a" });
    expect(r).toMatchObject({ restoredFrom: "2026-01-01T00:00:00.000Z#a", checkpointBeforeRestore: true, liveBody: "updated", liveClients: 2 });
    expect(roomTexts()).toEqual(["Old body"]);
    expect(broadcastMock.broadcastRoomUpdate).toHaveBeenCalledWith(ROOM, expect.any(Uint8Array));
    const saved = fake.tables.pages.find((p) => p.id === "p1") as Item;
    expect(saved.title).toBe("Old title");
    expect(JSON.stringify(saved.doc)).toContain("Old body");
    const kinds = fake.tables["page-history"].map((h) => h.kind);
    expect(kinds).toContain("page.checkpoint");
    expect(kinds).toContain("page.restoreVersion");
    const checkpoint = fake.tables["page-history"].find((h) => h.kind === "page.checkpoint") as Item;
    expect(JSON.stringify(checkpoint.snapshot)).toContain("Current body");
    expect(publishMock.publishPage).toHaveBeenCalled();
  });

  it("restore_page_version: 빈 룸이면 룸은 비워 두고 Pages.doc 만 복원(첫 진입 클라가 복원본으로 시드)", async () => {
    const { ctx, fake } = setupWithHistory();
    const r = await restorePageVersionTool(ctx, { pageId: "p1", historyId: "2026-01-01T00:00:00.000Z#a" });
    expect(r.liveBody).toBe("unchanged");
    expect(rooms.has(ROOM)).toBe(false);
    expect(JSON.stringify((fake.tables.pages.find((p) => p.id === "p1") as Item).doc)).toContain("Old body");
  });

  it("restore_page_version: 휴지통 페이지도 되살린다", async () => {
    const { ctx, fake } = setupWithHistory(WRITE, { deletedAt: daysAgo(1) });
    const r = await restorePageVersionTool(ctx, { pageId: "p1", historyId: "2026-01-02T00:00:00.000Z#b" });
    expect(r.wasInTrash).toBe(true);
    expect((fake.tables.pages.find((p) => p.id === "p1") as Item).deletedAt).toBeUndefined();
  });

  it("restore_page_version: 빈 본문 버전은 거부(본문 전체 비우기 방지), 없는 historyId 는 not found", async () => {
    const { ctx, fake } = setupWithHistory();
    fake.tables["page-history"].push(historyEntry("p1", "2026-01-03T00:00:00.000Z#c", { id: "p1", workspaceId: "ws-a", doc: JSON.stringify(docOf({ type: "paragraph" })) }));
    seedRoom(ROOM, CURRENT);
    await expect(restorePageVersionTool(ctx, { pageId: "p1", historyId: "2026-01-03T00:00:00.000Z#c" })).rejects.toThrow(/empty body/);
    await expect(restorePageVersionTool(ctx, { pageId: "p1", historyId: "nope" })).rejects.toThrow(VERSION_NOT_FOUND);
    expect(appended).toHaveLength(0);
  });

  it("restore_page_version: read 토큰·view 권한·read 정책 워크스페이스는 거부", async () => {
    const id = "2026-01-01T00:00:00.000Z#a";
    const { ctx: readCtx } = setupWithHistory(READ);
    await expect(restorePageVersionTool(readCtx, { pageId: "p1", historyId: id })).rejects.toThrow(WRITE_SCOPE_ERROR);
    const { ctx: viewCtx } = setupPages([page("pb", { workspaceId: "ws-b" })]);
    await expect(restorePageVersionTool(viewCtx, { pageId: "pb", historyId: id })).rejects.toThrow(EDIT_ACCESS_ERROR);
    const { ctx: policyCtx } = setupPages([page("p1")], WRITE, (t) => {
      (t.workspaces[0] as Item).mcpPolicy = "read";
    });
    await expect(restorePageVersionTool(policyCtx, { pageId: "p1", historyId: id })).rejects.toThrow(READ_ONLY_POLICY_ERROR);
  });

  it("restore_page_version(DB 행): 그 시점 셀로 DB 룸을 정확히 복원(없던 셀 삭제)·멤버십 복귀", async () => {
    const { ctx, fake } = setupDb();
    fake.tables["page-history"] = [historyEntry("r1", "2026-01-01T00:00:00.000Z#a", {
      id: "r1", workspaceId: "ws-a", databaseId: "db1", title: "Alpha", dbCells: JSON.stringify({ "c-pts": 1 }),
      doc: JSON.stringify(docOf(para("body Alpha", "blk-r1"))),
    })];
    seedDbRoom("db1", { columns: COLUMNS, rows: { r1: { "c-pts": 5, "c-ok": true } }, order: ["r2"], members: ["r2"] });
    const r = await restorePageVersionTool(ctx, { pageId: "r1", historyId: "2026-01-01T00:00:00.000Z#a" });
    expect(r.cellsWrittenTo).toBe("collab");
    const db = readDbRoom("db1") as { rows: Record<string, Item>; rowMembers: string[]; rowPageOrder: string[] };
    expect(db.rows.r1).toEqual({ "c-pts": 1 });
    expect(db.rowMembers).toContain("r1");
    expect(db.rowPageOrder).toContain("r1");
  });

  it("save_page_version: 협업 룸 본문으로 체크포인트 기록·historyId 반환, 휴지통 페이지 거부", async () => {
    const { ctx, fake } = setupPages([page("p1"), page("pt", { deletedAt: daysAgo(1) })]);
    seedRoom(ROOM, docOf(para("Live edit not yet materialized")));
    const r = await savePageVersionTool(ctx, { pageId: "p1" });
    expect(r.saved).toBe(true);
    const checkpoint = fake.tables["page-history"].find((h) => h.historyId === r.historyId) as Item;
    expect(JSON.stringify(checkpoint.snapshot)).toContain("Live edit not yet materialized");
    await expect(savePageVersionTool(ctx, { pageId: "pt" })).rejects.toThrow(/trash/);
  });
});

describe("DB 버전 히스토리", () => {
  const OLD_COLUMNS = [COLUMNS[0], COLUMNS[1]];

  function setupDbHistory(token: object = WRITE) {
    const r = setupDb({ token });
    r.fake.tables["database-history"] = [{
      databaseId: "db1", historyId: "2026-01-01T00:00:00.000Z#a", workspaceId: "ws-a", kind: "database.session",
      createdAt: T0, createdByName: "Bob",
      snapshot: { id: "db1", workspaceId: "ws-a", title: "Old Tasks", columns: JSON.stringify(OLD_COLUMNS), rowPageOrder: ["r1", "r2"] },
    }];
    r.fake.tables["page-history"] = [
      historyEntry("r9", "2026-01-05T00:00:00.000Z#d", { id: "r9", title: "Gone row", databaseId: "db1" }, { databaseId: "db1", kind: "page.delete" }),
    ];
    return r;
  }

  it("list_database_history: 컬럼·행 수 요약", async () => {
    const { ctx } = setupDbHistory(READ);
    const r = await listDatabaseHistoryTool(ctx, { databaseId: "db1" });
    expect(r.versions[0]).toMatchObject({ historyId: "2026-01-01T00:00:00.000Z#a", title: "Old Tasks", columns: 2, rows: 2 });
  });

  it("list_database_row_history: 삭제 행 포함·rowDeleted 표시", async () => {
    const { ctx } = setupDbHistory(READ);
    const r = await listDatabaseRowHistoryTool(ctx, { databaseId: "db1" });
    expect(r.entries[0]).toMatchObject({ pageId: "r9", rowDeleted: true, title: "Gone row" });
  });

  it("restore_database_version: 체크포인트 → Databases 복원 → 룸 columns 를 복원본으로 교체·발행·홈 제목 동기화", async () => {
    const home = page("home", { title: "Tasks", fullPageDatabaseId: "db1" });
    const { ctx, fake } = setupDbHistory();
    fake.tables.pages.push(home);
    seedDbRoom("db1", { columns: COLUMNS, rows: {}, order: ["r1"] });
    const r = await restoreDatabaseVersionTool(ctx, { databaseId: "db1", historyId: "2026-01-01T00:00:00.000Z#a" });
    expect(r).toMatchObject({ structureWrittenTo: "collab", title: "Old Tasks", homePageRenamed: "home" });
    const room = readDbRoom("db1") as { columns: Item[] };
    expect(room.columns.map((c) => c.id)).toEqual(["c-title", "c-status"]);
    const saved = fake.tables.databases.find((d) => d.id === "db1") as Item;
    expect(JSON.parse(String(saved.columns))).toHaveLength(2);
    expect(fake.tables["database-history"].some((h) => h.kind === "database.checkpoint")).toBe(true);
    expect(publishMock.publishDatabase).toHaveBeenCalled();
    expect((fake.tables.pages.find((p) => p.id === "home") as Item).title).toBe("Old Tasks");
  });

  it("restore_database_version: 스케줄러 DB·read 토큰 거부", async () => {
    const { ctx } = setupDbHistory();
    await expect(restoreDatabaseVersionTool(ctx, { databaseId: "lc-scheduler-db:ws", historyId: "x" })).rejects.toThrow(/scheduler/);
    const { ctx: readCtx } = setupDbHistory(READ);
    await expect(restoreDatabaseVersionTool(readCtx, { databaseId: "db1", historyId: "x" })).rejects.toThrow(WRITE_SCOPE_ERROR);
  });
});

describe("휴지통", () => {
  it("list_trash: 페이지·DB 를 남은 일수와 함께", async () => {
    const { ctx } = setupPages([page("t1", { deletedAt: daysAgo(2) })], READ, (t) => {
      t.databases = [{ id: "dbx", workspaceId: "ws-a", title: "Old DB", deletedAt: daysAgo(29) }];
    });
    const r = await listTrashTool(ctx, { workspaceId: "ws-a" });
    expect(r.pages).toEqual([expect.objectContaining({ id: "t1", type: "page", daysUntilPurge: 28 })]);
    expect(r.databases).toEqual([expect.objectContaining({ id: "dbx", title: "Old DB", daysUntilPurge: 1 })]);
    await expect(listTrashTool(ctx, { workspaceId: "ws-c" })).rejects.toThrow(NOT_ACCESSIBLE);
  });

  it("restore_page: trash_page 로 함께 버린 자손까지 복원·발행, 따로 버린 자손은 남김", async () => {
    const { ctx, fake } = setupPages([page("a"), page("a1", { parentId: "a" }), page("a2", { parentId: "a", deletedAt: daysAgo(5) })]);
    await trashPageTool(ctx, { pageId: "a" });
    publishMock.publishPage.mockClear();
    const r = await restorePageTool(ctx, { pageId: "a" });
    expect(r.restored.sort()).toEqual(["a", "a1"]);
    expect(fake.tables.pages.find((p) => p.id === "a")?.deletedAt).toBeUndefined();
    expect(fake.tables.pages.find((p) => p.id === "a")?.purgeAt).toBeUndefined();
    expect(fake.tables.pages.find((p) => p.id === "a2")?.deletedAt).toBeTruthy();
    expect(publishMock.publishPage).toHaveBeenCalledTimes(2);
    await expect(restorePageTool(ctx, { pageId: "a" })).rejects.toThrow(/not in the trash/);
  });

  it("restore_page(DB 행): trash_page 가 룸에서 뺀 행을 셀과 함께 되살린다", async () => {
    const { ctx } = setupDb();
    seedDbRoom("db1", { columns: COLUMNS, rows: { r1: { "c-pts": 5 }, r2: {} }, order: ["r1", "r2"] });
    await trashPageTool(ctx, { pageId: "r1" });
    expect((readDbRoom("db1") as { rowMembers: string[] }).rowMembers).toEqual(["r2"]);
    const r = await restorePageTool(ctx, { pageId: "r1" });
    expect(r).toMatchObject({ restored: ["r1"], rowRestoredTo: "collab" });
    const room = readDbRoom("db1") as { rows: Record<string, Item>; rowMembers: string[] };
    expect(room.rowMembers).toContain("r1");
    expect(room.rows.r1).toMatchObject({ "c-pts": 5, "c-ok": true });
  });

  it("trash_database → restore_database: 행·홈·DB 를 함께 버리고 함께 되살린다(tombstone 발행)", async () => {
    const home = page("home", { title: "Tasks", fullPageDatabaseId: "db1" });
    const { ctx, fake } = setupDb({ rows: [row("r1", "Alpha", 1), row("r2", "Beta", 2)], extraPages: [home] });
    const t = await trashDatabaseTool(ctx, { databaseId: "db1" });
    expect(t).toMatchObject({ trashedRows: 2, trashedHomePage: "home" });
    expect(fake.tables.databases[0].deletedAt).toBeTruthy();
    expect(fake.tables.pages.every((p) => p.deletedAt)).toBe(true);
    expect(publishMock.publishDatabase).toHaveBeenCalledWith(expect.objectContaining({ id: "db1" }), { deletedAt: expect.any(String) });
    await expect(trashDatabaseTool(ctx, { databaseId: "db1" })).rejects.toThrow(/already in the trash/);

    const r = await restoreDatabaseTool(ctx, { databaseId: "db1" });
    expect(r.restoredPages.sort()).toEqual(["home", "r1", "r2"]);
    expect(fake.tables.databases[0].deletedAt).toBeUndefined();
    expect(fake.tables.pages.some((p) => p.deletedAt)).toBe(false);
  });

  it("trash_database: 스케줄러 보호 DB·view 권한 거부", async () => {
    const { ctx } = setupDb();
    await expect(trashDatabaseTool(ctx, { databaseId: "lc-milestone-db:x" })).rejects.toThrow(/scheduler/);
    const { ctx: viewCtx } = setupPages([], WRITE, (t) => {
      t.databases = [{ id: "dbb", workspaceId: "ws-b", title: "B" }];
    });
    await expect(trashDatabaseTool(viewCtx, { databaseId: "dbb" })).rejects.toThrow(EDIT_ACCESS_ERROR);
  });
});

describe("영구 삭제(confirm 필수)", () => {
  it("permanently_delete_page: confirm 없으면 거부, 휴지통 밖 페이지 거부, 휴지통 페이지·댓글 삭제", async () => {
    const { ctx, fake } = setupPages([page("t1", { deletedAt: daysAgo(1) }), page("live")], WRITE, (t) => {
      t.comments = [{ id: "c1", workspaceId: "ws-a", pageId: "t1", blockId: "b", bodyText: "x" }];
    });
    await expect(permanentlyDeletePageTool(ctx, { pageId: "t1" })).rejects.toThrow(CONFIRM_REQUIRED);
    await expect(permanentlyDeletePageTool(ctx, { pageId: "t1", confirm: false })).rejects.toThrow(CONFIRM_REQUIRED);
    expect(fake.tables.pages).toHaveLength(2);
    await expect(permanentlyDeletePageTool(ctx, { pageId: "live", confirm: true })).rejects.toThrow(/Only pages in the trash/);
    expect(await permanentlyDeletePageTool(ctx, { pageId: "t1", confirm: true })).toMatchObject({ deleted: "t1", permanent: true });
    expect(fake.tables.pages.map((p) => p.id)).toEqual(["live"]);
    expect(fake.tables.comments).toHaveLength(0);
  });

  it("permanently_delete_page: 접근 불가 워크스페이스는 confirm 이 있어도 존재를 숨긴다", async () => {
    const { ctx } = setupPages([page("tc", { workspaceId: "ws-c", deletedAt: daysAgo(1) })]);
    await expect(permanentlyDeletePageTool(ctx, { pageId: "tc", confirm: true })).rejects.toThrow(NOT_ACCESSIBLE);
  });

  it("permanently_delete_database: confirm·휴지통 상태 필수, 스케줄러 DB 거부, 행까지 삭제", async () => {
    const { ctx, fake } = setupDb({ rows: [row("r1", "Alpha", 1)] });
    await expect(permanentlyDeleteDatabaseTool(ctx, { databaseId: "db1" })).rejects.toThrow(CONFIRM_REQUIRED);
    await expect(permanentlyDeleteDatabaseTool(ctx, { databaseId: "db1", confirm: true })).rejects.toThrow(/Only databases in the trash/);
    await expect(permanentlyDeleteDatabaseTool(ctx, { databaseId: "lc-scheduler-db:ws-a", confirm: true })).rejects.toThrow(/scheduler/);
    fake.tables.databases[0].deletedAt = daysAgo(1);
    await permanentlyDeleteDatabaseTool(ctx, { databaseId: "db1", confirm: true });
    expect(fake.tables.databases).toHaveLength(0);
    expect(fake.tables.pages).toHaveLength(0);
  });

  it("empty_trash: confirm 필수, 대상 워크스페이스만 비우고 개수 반환, 권한 없는 WS 거부", async () => {
    const { ctx, fake } = setupPages([page("t1", { deletedAt: daysAgo(1) }), page("t2", { deletedAt: daysAgo(3) }), page("b1", { workspaceId: "ws-b", deletedAt: daysAgo(1) })]);
    await expect(emptyTrashTool(ctx, { workspaceId: "ws-a" })).rejects.toThrow(CONFIRM_REQUIRED);
    expect(await emptyTrashTool(ctx, { workspaceId: "ws-a", confirm: true })).toMatchObject({ deletedPages: 2 });
    expect(fake.tables.pages.map((p) => p.id)).toEqual(["b1"]);
    await expect(emptyTrashTool(ctx, { workspaceId: "ws-b", confirm: true })).rejects.toThrow(EDIT_ACCESS_ERROR);
    await expect(emptyTrashTool(ctx, { workspaceId: "ws-c", confirm: true })).rejects.toThrow(NOT_ACCESSIBLE);
  });

  it("일괄 툴은 인가·confirm 뒤 영향 페이지 수만큼 일일 쓰기 상한을 소비한다", async () => {
    const home = page("home", { title: "Tasks", fullPageDatabaseId: "db1" });
    const { ctx, fake } = setupDb({ rows: [row("r1", "Alpha", 1), row("r2", "Beta", 2)], extraPages: [home] });
    await trashDatabaseTool(ctx, { databaseId: "db1" });
    expect(chargedUnits(fake)).toBe(4); // DB + 행 2 + 홈
    await restoreDatabaseTool(ctx, { databaseId: "db1" });
    expect(chargedUnits(fake)).toBe(8);

    const { ctx: c2, fake: f2 } = setupPages([page("t1", { deletedAt: daysAgo(1) }), page("t2", { deletedAt: daysAgo(3) }), page("tc", { workspaceId: "ws-c", deletedAt: daysAgo(1) })]);
    await expect(emptyTrashTool(c2, { workspaceId: "ws-a" })).rejects.toThrow(CONFIRM_REQUIRED);
    await expect(permanentlyDeletePageTool(c2, { pageId: "tc", confirm: true })).rejects.toThrow(NOT_ACCESSIBLE);
    expect(chargedUnits(f2)).toBe(0);
    await emptyTrashTool(c2, { workspaceId: "ws-a", confirm: true });
    expect(chargedUnits(f2)).toBe(2);
  });

  it("empty_trash: 남은 일일 한도보다 많으면 아무것도 지우지 않고 거부", async () => {
    vi.stubEnv("MCP_DAILY_WRITE_LIMIT", "2");
    try {
      const { ctx, fake } = setupPages([page("t1", { deletedAt: daysAgo(1) }), page("t2", { deletedAt: daysAgo(1) }), page("t3", { deletedAt: daysAgo(1) })]);
      await expect(emptyTrashTool(ctx, { workspaceId: "ws-a", confirm: true })).rejects.toThrow(/Daily write limit/);
      expect(fake.tables.pages).toHaveLength(3);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("trash_database: 워크스페이스 메타 스캔 상한과 무관하게 행을 GSI 로 빠짐없이 찾는다", async () => {
    const { ctx, fake } = setupDb({ rows: [row("r1", "Alpha", 1), row("r2", "Beta", 2)] });
    await trashDatabaseTool(ctx, { databaseId: "db1" });
    const q = fake.calls.find((c) => c.constructor.name === "QueryCommand" && c.input.IndexName === "byDatabaseAndOrder");
    expect(q?.input).toMatchObject({ KeyConditionExpression: "databaseId = :d", ExpressionAttributeValues: { ":d": "db1" } });
    expect(fake.tables.pages.filter((p) => p.databaseId === "db1").every((p) => p.deletedAt)).toBe(true);
  });

  it("read 토큰은 모든 히스토리 쓰기 툴에서 거부", async () => {
    const { ctx } = setupPages([page("t1", { deletedAt: daysAgo(1) })], READ, (t) => {
      t.databases = [{ id: "dbx", workspaceId: "ws-a", title: "X", deletedAt: daysAgo(1) }];
    });
    const calls = [
      () => savePageVersionTool(ctx, { pageId: "t1" }),
      () => restorePageTool(ctx, { pageId: "t1" }),
      () => restoreDatabaseTool(ctx, { databaseId: "dbx" }),
      () => trashDatabaseTool(ctx, { databaseId: "dbx" }),
      () => permanentlyDeletePageTool(ctx, { pageId: "t1", confirm: true }),
      () => permanentlyDeleteDatabaseTool(ctx, { databaseId: "dbx", confirm: true }),
      () => emptyTrashTool(ctx, { workspaceId: "ws-a", confirm: true }),
    ];
    for (const call of calls) await expect(call()).rejects.toThrow(WRITE_SCOPE_ERROR);
  });
});
