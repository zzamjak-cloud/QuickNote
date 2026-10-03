import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createCommentTool } from "../tools/createComment";
import { createPagesTool } from "../tools/createPages";
import { duplicatePageTool } from "../tools/duplicatePage";
import { movePagesTool } from "../tools/movePages";
import { trashPageTool } from "../tools/trashPage";
import { updatePageTool } from "../tools/updatePage";
import { WRITE_SCOPE_ERROR } from "../writeAccess";
import { appended, docOf, para, publishMock, resetCollabMocks, rooms } from "./collabMocks";
import { baseTables, makeCtx } from "./fixtures";
import type { Item } from "./fakeDdb";

vi.mock("../../realtime/yjsStore", async () => (await import("./collabMocks")).yjsStoreMock);
vi.mock("../wsBroadcast", async () => (await import("./collabMocks")).broadcastMock);
vi.mock("../publish", async () => (await import("./collabMocks")).publishMock);

const WRITE = { scopes: ["read", "write"] as ("read" | "write")[] };
const COLUMNS = [
  { id: "c-title", name: "Name", type: "title" },
  { id: "c-status", name: "Status", type: "status", config: { options: [{ id: "o-todo", label: "Todo" }, { id: "o-done", label: "Done" }] } },
  { id: "c-tags", name: "Tags", type: "multiSelect", config: { options: [{ id: "t1", label: "red" }, { id: "t2", label: "blue" }] } },
  { id: "c-due", name: "Due", type: "date" },
  { id: "c-owner", name: "Owner", type: "person" },
  { id: "c-pts", name: "Points", type: "number" },
  { id: "c-ok", name: "Done?", type: "checkbox" },
  { id: "c-file", name: "Files", type: "file" },
];

function page(id: string, extra: Item = {}): Item {
  return { id, workspaceId: "ws-a", title: id, order: "0", parentId: null, updatedAt: "2026-01-01T00:00:00.000Z", doc: JSON.stringify(docOf(para(`body ${id}`, `blk-${id}`))), ...extra };
}

function setup(pages: Item[] = [], token = WRITE) {
  const tables = baseTables();
  tables.pages = pages;
  tables.databases = [{ id: "db1", workspaceId: "ws-a", title: "Tasks", columns: JSON.stringify(COLUMNS) }];
  tables["workspace-access"].push({ workspaceId: "ws-a", subjectKey: "member#m2", subjectType: "member", subjectId: "m2", level: "view" });
  return makeCtx(tables, token);
}

const byId = (fake: ReturnType<typeof setup>["fake"], id: string) => fake.tables.pages.find((p) => p.id === id) as Item;

beforeEach(() => resetCollabMocks());

describe("쓰기 scope", () => {
  it("read 전용 토큰은 모든 쓰기 툴에서 거부", async () => {
    const { ctx } = setup([page("p1")], { scopes: ["read"] });
    const calls = [
      () => createPagesTool(ctx, { parent: { workspaceId: "ws-a" }, pages: [{ title: "x" }] }),
      () => updatePageTool(ctx, { pageId: "p1", title: "x" }),
      () => movePagesTool(ctx, { pageIds: ["p1"], newParent: { workspaceId: "ws-a" } }),
      () => duplicatePageTool(ctx, { pageId: "p1" }),
      () => trashPageTool(ctx, { pageId: "p1" }),
      () => createCommentTool(ctx, { pageId: "p1", text: "hi" }),
    ];
    for (const call of calls) await expect(call()).rejects.toThrow(WRITE_SCOPE_ERROR);
  });

  it("타인의 개인 워크스페이스에는 상위 역할이어도 쓸 수 없다", async () => {
    const { ctx, fake } = setup();
    fake.tables.workspaces.push({ workspaceId: "ws-personal-m2", type: "personal", ownerMemberId: "m2" });
    const owner = { ...ctx, caller: { ...ctx.caller, workspaceRole: "owner" as const } };
    await expect(createPagesTool(owner, { parent: { workspaceId: "ws-personal-m2" }, pages: [{ title: "x" }] }))
      .rejects.toThrow(/Not found or not accessible/);
  });
});

describe("create_pages", () => {
  it("페이지 하위·루트 생성: 형제 끝 순서, 제목 중복 회피, 블록 id 부여, publish", async () => {
    const { ctx, fake } = setup([page("parent"), page("c1", { parentId: "parent", order: "4" }), page("dup", { title: "Notes" })]);
    const r = await createPagesTool(ctx, {
      parent: { pageId: "parent" },
      pages: [{ title: "Notes", content: "# Hello\n\nbody" }, { title: "Notes", icon: "📝" }],
    });
    expect(r.pages.map((p) => p.title)).toEqual(["Notes (1)", "Notes (2)"]);
    const [a, b] = r.pages.map((p) => byId(fake, p.id));
    expect(a).toMatchObject({ parentId: "parent", order: "5", workspaceId: "ws-a", createdByMemberId: "m1" });
    expect(b).toMatchObject({ order: "6", icon: "📝" });
    const doc = JSON.parse(String(a.doc));
    expect(doc.content[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
    expect(typeof doc.content[0].attrs.id).toBe("string");
    expect(publishMock.publishPage).toHaveBeenCalledTimes(2);
    expect(appended).toHaveLength(0); // 신규 페이지는 룸을 만들지 않는다
  });

  it("DB 행: 사람 값 → 셀 변환(옵션 라벨·이메일·날짜), 빈 DB 룸이면 Pages.dbCells 만", async () => {
    const { ctx, fake } = setup();
    const r = await createPagesTool(ctx, {
      parent: { databaseId: "db1" },
      pages: [{ properties: { Name: "Row 1", Status: "done", Tags: ["red", "blue"], Due: "2026-10-05", Owner: "bob@example.com", Points: "3", "Done?": true } }],
    });
    const row = byId(fake, r.pages[0].id);
    expect(row).toMatchObject({ title: "Row 1", databaseId: "db1", parentId: null });
    expect(JSON.parse(String(row.dbCells))).toEqual({
      "c-status": "o-done", "c-tags": ["t1", "t2"], "c-due": { start: "2026-10-05" }, "c-owner": ["m2"], "c-pts": 3, "c-ok": true,
    });
    expect(r.pages[0].cellsWrittenTo).toBe("pages");
  });

  it("DB 행: 시드된 DB 룸이 있으면 같은 트랜잭션에서 rows·rowMembers·rowPageOrder 에 기록(중복 없음)", async () => {
    const seeded = new Y.Doc();
    const root = seeded.getMap("db");
    root.set("columns", new Y.Array());
    const members = new Y.Array<string>();
    members.push(["old"]);
    root.set("rowMembers", members);
    const order = new Y.Array<string>();
    order.push(["old"]);
    root.set("rowPageOrder", order);
    rooms.set("db:v5:db1", Y.encodeStateAsUpdate(seeded));
    const { ctx } = setup();
    const r = await createPagesTool(ctx, { parent: { databaseId: "db1" }, pages: [{ title: "R", properties: { Status: "Todo" } }, { title: "Empty" }] });
    expect(r.pages.map((p) => p.cellsWrittenTo)).toEqual(["collab", "collab"]);
    expect(appended.filter((a) => a.room === "db:v5:db1")).toHaveLength(2);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, rooms.get("db:v5:db1")!);
    const db = doc.getMap("db");
    const [a, b] = r.pages.map((p) => p.id);
    expect((db.get("rows") as Y.Map<Y.Map<unknown>>).get(a)?.toJSON()).toEqual({ "c-status": "o-todo" });
    expect((db.get("rows") as Y.Map<Y.Map<unknown>>).get(b)?.toJSON()).toEqual({});
    expect((db.get("rowMembers") as Y.Array<string>).toArray()).toEqual(["old", a, b]);
    expect((db.get("rowPageOrder") as Y.Array<string>).toArray()).toEqual(["old", a, b]);
  });

  it("DB 행: rowMembers 가 빈 구버전 룸이면 멤버는 건드리지 않고 순서에만 추가(기존 행 숨김 방지)", async () => {
    const seeded = new Y.Doc();
    seeded.getMap("db").set("columns", new Y.Array());
    seeded.getMap("db").set("rowMembers", new Y.Array());
    rooms.set("db:v5:db1", Y.encodeStateAsUpdate(seeded));
    const { ctx } = setup();
    const r = await createPagesTool(ctx, { parent: { databaseId: "db1" }, pages: [{ title: "R" }] });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, rooms.get("db:v5:db1")!);
    expect((doc.getMap("db").get("rowMembers") as Y.Array<string>).length).toBe(0);
    expect((doc.getMap("db").get("rowPageOrder") as Y.Array<string>).toArray()).toEqual([r.pages[0].id]);
  });

  it("person: 워크스페이스 접근이 없는 멤버는 없는 멤버와 같은 오류", async () => {
    const { ctx, fake } = setup();
    fake.tables.members.push({ memberId: "m3", email: "carol@example.com", name: "Carol", status: "active", workspaceRole: "member" });
    const row = (Owner: string) => createPagesTool(ctx, { parent: { databaseId: "db1" }, pages: [{ properties: { Owner } }] });
    const message = (p: Promise<unknown>) => p.then(() => "", (e: Error) => e.message);
    const outsider = await message(row("carol@example.com"));
    const ghost = await message(row("nobody@example.com"));
    expect(ghost).toMatch(/unknown member/);
    expect(outsider.replace("carol", "X")).toBe(ghost.replace("nobody", "X"));
    await expect(row("m3")).rejects.toThrow(/unknown member "m3" in this workspace/);
  });

  it("본문 350KB 초과·허용되지 않은 아이콘은 쓰기 전에 전부 거부", async () => {
    const { ctx, fake } = setup([page("p1")]);
    const big = "x".repeat(360 * 1024);
    await expect(createPagesTool(ctx, { parent: { pageId: "p1" }, pages: [{ title: "ok" }, { title: "big", content: big }] }))
      .rejects.toThrow(/max 358400/);
    for (const icon of ["https://evil.example/pixel.png", "data:image/png;base64,AA", "hello", "quicknote-image://../x"]) {
      await expect(createPagesTool(ctx, { parent: { pageId: "p1" }, pages: [{ title: "i", icon }] })).rejects.toThrow(/icon must be/);
    }
    expect(fake.tables.pages).toHaveLength(1);
    const r = await createPagesTool(ctx, {
      parent: { pageId: "p1" },
      pages: ["🚀", "👍🏽", "🇰🇷", "quicknote-lucide:Star:f59e0b", "quicknote-image://img_123-abc"].map((icon, i) => ({ title: `t${i}`, icon })),
    });
    expect(r.pages).toHaveLength(5);
  });

  it("속성 변환 오류: 미지 옵션(유효 목록 안내)·미지원 타입·미지 컬럼·잘못된 날짜·일반 페이지 속성", async () => {
    const { ctx, fake } = setup([page("p1")]);
    const row = (properties: Record<string, unknown>) => createPagesTool(ctx, { parent: { databaseId: "db1" }, pages: [{ properties }] });
    await expect(row({ Status: "Blocked" })).rejects.toThrow(/Valid options: Todo, Done/);
    await expect(row({ Files: "a.pdf" })).rejects.toThrow(/cannot be written via MCP/);
    await expect(row({ Nope: 1 })).rejects.toThrow(/Unknown property "Nope"/);
    await expect(row({ Due: "10/05/2026" })).rejects.toThrow(/YYYY-MM-DD/);
    await expect(row({ Owner: "ghost@example.com" })).rejects.toThrow(/unknown member "ghost@example.com" in this workspace/);
    await expect(createPagesTool(ctx, { parent: { pageId: "p1" }, pages: [{ properties: { a: 1 } }] })).rejects.toThrow(/database rows/);
    expect(fake.tables.pages).toHaveLength(1); // 검증 실패 시 아무것도 만들지 않는다
  });
});

describe("move_pages", () => {
  it("새 부모 형제 끝으로 이동, 자기 자손 아래·DB 행·다른 워크스페이스는 거부", async () => {
    const { ctx, fake } = setup([
      page("a"), page("a1", { parentId: "a" }), page("b"), page("b1", { parentId: "b", order: "7" }),
      page("row", { databaseId: "db1" }), page("other", { workspaceId: "ws-c" }),
    ]);
    await expect(movePagesTool(ctx, { pageIds: ["a"], newParent: { pageId: "a1" } })).rejects.toThrow(/descendants/);
    await expect(movePagesTool(ctx, { pageIds: ["a"], newParent: { pageId: "a" } })).rejects.toThrow(/descendants/);
    await expect(movePagesTool(ctx, { pageIds: ["row"], newParent: { pageId: "b" } })).rejects.toThrow(/database row/);
    await expect(movePagesTool(ctx, { pageIds: ["a"], newParent: { workspaceId: "ws-b" } })).rejects.toThrow(/another workspace/);
    const r = await movePagesTool(ctx, { pageIds: ["a", "a1"], newParent: { pageId: "b" } });
    expect(r.moved.map((m) => m.parentId)).toEqual(["b", "b"]);
    expect(byId(fake, "a")).toMatchObject({ parentId: "b", order: "8" });
    expect(byId(fake, "a1")).toMatchObject({ parentId: "b", order: "9" });
  });
});

describe("trash_page", () => {
  it("자손까지 soft delete(deletedAt·purgeAt)·tombstone 발행, 영구삭제 없음", async () => {
    const { ctx, fake } = setup([page("a"), page("a1", { parentId: "a" }), page("a11", { parentId: "a1" }), page("x"), page("row", { databaseId: "db1" })]);
    const r = await trashPageTool(ctx, { pageId: "a" });
    expect(r.trashed.sort()).toEqual(["a", "a1", "a11"]);
    for (const id of ["a", "a1", "a11"]) {
      const p = byId(fake, id);
      expect(p.deletedAt).toBeTruthy();
      expect(typeof p.purgeAt).toBe("number");
    }
    expect(byId(fake, "x").deletedAt).toBeUndefined();
    expect(fake.tables.pages).toHaveLength(5);
    expect(publishMock.publishPage).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" }), { deletedAt: expect.any(String) });
    await expect(trashPageTool(ctx, { pageId: "a" })).rejects.toThrow(/trash/);
  });
});

describe("duplicate_page", () => {
  it("현재 협업 본문으로 \"(Copy)\" 를 원본 바로 다음에 만들고 블록 id 는 새로 만든다", async () => {
    const { ctx, fake } = setup([page("src", { order: "1", icon: "⭐" }), page("next", { order: "2" })]);
    const r = await duplicatePageTool(ctx, { pageId: "src" });
    const copy = byId(fake, r.id);
    expect(copy).toMatchObject({ title: "src (Copy)", order: "1.5", icon: "⭐", parentId: null });
    const block = JSON.parse(String(copy.doc)).content[0];
    expect(block.content[0].text).toBe("body src");
    expect(block.attrs.id).not.toBe("blk-src");
  });
});

describe("create_comment", () => {
  it("기본은 첫 블록에, 없는 블록 id 는 거부", async () => {
    const { ctx, fake } = setup([page("p1")]);
    const r = await createCommentTool(ctx, { pageId: "p1", text: "Looks good" });
    expect(r.blockId).toBe("blk-p1");
    expect(fake.tables.comments[0]).toMatchObject({ pageId: "p1", blockId: "blk-p1", authorMemberId: "m1", bodyText: "Looks good" });
    await expect(createCommentTool(ctx, { pageId: "p1", text: "x", blockId: "missing" })).rejects.toThrow(/not found/);
  });
});
