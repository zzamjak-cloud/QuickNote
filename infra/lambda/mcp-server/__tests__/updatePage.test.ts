import { beforeEach, describe, expect, it, vi } from "vitest";
import { stateToDocJson, type DocJson } from "../../_shared/collabContent";
import { docToQfm } from "../../../../src/lib/docModel/markdown";
import { updatePageTool } from "../tools/updatePage";
import { WRITE_SCOPE_ERROR, EDIT_ACCESS_ERROR } from "../writeAccess";
import { appended, broadcastMock, docOf, para, resetCollabMocks, rooms, seedRoom } from "./collabMocks";
import { baseTables, makeCtx } from "./fixtures";
import type { Item } from "./fakeDdb";

vi.mock("../../realtime/yjsStore", async () => (await import("./collabMocks")).yjsStoreMock);
vi.mock("../wsBroadcast", async () => (await import("./collabMocks")).broadcastMock);
vi.mock("../publish", async () => (await import("./collabMocks")).publishMock);

const ROOM = "v5:p1";
const WRITE = { scopes: ["read", "write"] as ("read" | "write")[] };

function setup(doc: DocJson | null, pageOverrides: Item = {}) {
  const tables = baseTables();
  tables.pages = [{
    id: "p1", workspaceId: "ws-a", title: "Page", order: "0", parentId: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    ...(doc ? { doc: JSON.stringify(doc) } : {}),
    ...pageOverrides,
  }];
  tables.databases = [{ id: "db1", workspaceId: "ws-a", title: "Tasks", columns: "[]" }];
  return makeCtx(tables, WRITE);
}

function roomTexts(room = ROOM): string[] {
  return (stateToDocJson(rooms.get(room) ?? new Uint8Array()).content ?? []).map((b) => b.content?.[0]?.text ?? "");
}

function savedPage(fake: ReturnType<typeof setup>["fake"]): Item {
  return fake.tables.pages.find((p) => p.id === "p1") as Item;
}

beforeEach(() => resetCollabMocks());

describe("update_page 본문 모드", () => {
  it("replace: 열린 룸에 diff update append → 브로드캐스트 → Pages.doc materialize·편집자 기록·체크포인트", async () => {
    const original = docOf(para("Keep", "b1"), para("Old", "b2"));
    const { ctx, fake } = setup(original);
    seedRoom(ROOM, original);
    fake.tables["page-history"] = [{ pageId: "p1", historyId: "2026-01-01#x", workspaceId: "ws-a", kind: "page.session", sessionStartedAt: "2026-01-01T00:00:00.000Z", lastActivityAt: "2026-01-01T00:00:00.000Z", snapshot: {} }];
    const r = await updatePageTool(ctx, { pageId: "p1", content: { mode: "replace", markdown: "Keep\n\nNew" } });
    expect(r).toMatchObject({ contentChanged: true, bodySource: "room", historyCheckpoint: true, liveClients: 2 });
    expect(appended).toHaveLength(1);
    expect(broadcastMock.broadcastRoomUpdate).toHaveBeenCalledWith(ROOM, appended[0].update);
    expect(roomTexts()).toEqual(["Keep", "New"]);
    // 유지 블록의 id 는 보존된다
    expect(stateToDocJson(rooms.get(ROOM)!).content?.[0].attrs?.id).toBe("b1");
    const page = savedPage(fake);
    expect(page.doc).toContain("New");
    expect(page).toMatchObject({ lastEditedByMemberId: "m1", lastEditSource: "mcp" });
    const checkpoint = fake.tables["page-history"].find((h) => h.kind === "page.checkpoint") as Item;
    expect(JSON.stringify(checkpoint.snapshot)).toContain("Old");
  });

  it("append: 빈 룸 + Pages.doc 본문 → 결정적 시드 위에 끝 삽입(체크포인트 없음)", async () => {
    const { ctx, fake } = setup(docOf(para("Existing", "b1")));
    const r = await updatePageTool(ctx, { pageId: "p1", content: { mode: "append", markdown: "Added" } });
    expect(r).toMatchObject({ bodySource: "seed", historyCheckpoint: false });
    expect(roomTexts()).toEqual(["Existing", "Added"]);
    expect(fake.tables["page-history"].some((h) => h.kind === "page.checkpoint")).toBe(false);
  });

  it("append: 빈 룸 + placeholder 본문 → allowEmptyRoom 으로 새 블록만", async () => {
    const { ctx } = setup(docOf({ type: "paragraph" }));
    const r = await updatePageTool(ctx, { pageId: "p1", content: { mode: "append", markdown: "First" } });
    expect(r).toMatchObject({ bodySource: "empty" });
    expect(roomTexts()).toEqual(["First"]);
  });

  it("replace: 룸이 빈 문단뿐(오염)이고 Pages.doc 에 본문 → Pages.doc 기준으로 룸 복구", async () => {
    const { ctx } = setup(docOf(para("Real body")));
    seedRoom(ROOM, docOf({ type: "paragraph" }));
    const r = await updatePageTool(ctx, { pageId: "p1", content: { mode: "append", markdown: "Tail" } });
    expect(r).toMatchObject({ bodySource: "repair" });
    expect(roomTexts()).toEqual(["Real body", "Tail"]);
  });

  it("insert_after: 앵커 0건·다건 오류, occurrence 로 선택, 마크다운 접두 허용", async () => {
    const original = docOf(para("Intro"), { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Goals" }] }, para("Dup"), para("Dup"));
    const { ctx } = setup(original);
    seedRoom(ROOM, original);
    await expect(updatePageTool(ctx, { pageId: "p1", content: { mode: "insert_after", markdown: "x", anchor: "Nope" } }))
      .rejects.toThrow(/does not match/);
    await expect(updatePageTool(ctx, { pageId: "p1", content: { mode: "insert_after", markdown: "x", anchor: "Dup" } }))
      .rejects.toThrow(/matches 2 blocks/);
    await updatePageTool(ctx, { pageId: "p1", content: { mode: "insert_after", markdown: "After goals", anchor: "## Goals" } });
    await updatePageTool(ctx, { pageId: "p1", content: { mode: "insert_after", markdown: "Second dup", anchor: "Dup", occurrence: 2 } });
    expect(roomTexts()).toEqual(["Intro", "Goals", "After goals", "Dup", "Dup", "Second dup"]);
  });

  it("replace_range: 시작~끝 블록을 교체하고 나머지는 보존", async () => {
    const original = docOf(para("A"), para("Start here"), para("middle"), para("End here"), para("Z"));
    const { ctx } = setup(original);
    seedRoom(ROOM, original);
    const r = await updatePageTool(ctx, {
      pageId: "p1",
      content: { mode: "replace_range", markdown: "Replaced", rangeStart: "Start", rangeEnd: "End" },
    });
    expect(r).toMatchObject({ historyCheckpoint: true });
    expect(roomTexts()).toEqual(["A", "Replaced", "Z"]);
  });

  it("qn-block: 현재 본문 참조는 보존, 미해결 참조는 오류, 삽입 모드는 기존 참조 불가", async () => {
    const flow = { type: "flowchartBlock", attrs: { flowchartId: "fc1", title: "Flow" } };
    const original = docOf(para("Top"), flow);
    const { ctx } = setup(original);
    seedRoom(ROOM, original);
    const qfm = docToQfm(original as never);
    expect(qfm).toContain('<qn-block id="fc1"');
    await updatePageTool(ctx, { pageId: "p1", content: { mode: "replace", markdown: qfm.replace("Top", "Top v2") } });
    const after = stateToDocJson(rooms.get(ROOM)!).content ?? [];
    expect(after.map((b) => b.type)).toEqual(["paragraph", "flowchartBlock"]);
    expect(after[1].attrs?.flowchartId).toBe("fc1");
    await expect(updatePageTool(ctx, { pageId: "p1", content: { mode: "replace", markdown: '<qn-block id="ghost" type="flowchartBlock"/>' } }))
      .rejects.toThrow(/UNRESOLVED_BLOCK_REF/);
    await expect(updatePageTool(ctx, { pageId: "p1", content: { mode: "append", markdown: '<qn-block id="fc1" type="flowchartBlock"/>' } }))
      .rejects.toThrow(/replace\/replace_range/);
  });

  it("database 블록 중복·미존재 DB 는 거부", async () => {
    const original = docOf(para("x"), { type: "databaseBlock", attrs: { databaseId: "db1" } });
    const { ctx } = setup(original);
    seedRoom(ROOM, original);
    await expect(updatePageTool(ctx, { pageId: "p1", content: { mode: "append", markdown: '<database id="db1"/>' } }))
      .rejects.toThrow(/more than once/);
    await expect(updatePageTool(ctx, { pageId: "p1", content: { mode: "append", markdown: '<database id="nope"/>' } }))
      .rejects.toThrow(/Unknown database/);
    expect(appended).toHaveLength(0);
  });

  it("입력 512KB 초과는 INPUT_TOO_LARGE, 변경 없는 replace·본문 전체 비우기는 룸을 건드리지 않음", async () => {
    const original = docOf(para("Same"));
    const { ctx } = setup(original);
    seedRoom(ROOM, original);
    await expect(updatePageTool(ctx, { pageId: "p1", content: { mode: "append", markdown: "x".repeat(513 * 1024) } }))
      .rejects.toThrow(/INPUT_TOO_LARGE/);
    const r = await updatePageTool(ctx, { pageId: "p1", content: { mode: "replace", markdown: "Same" } });
    expect(r.contentChanged).toBe(false);
    await expect(updatePageTool(ctx, { pageId: "p1", content: { mode: "replace", markdown: "" } })).rejects.toThrow(/Clearing/);
    expect(appended).toHaveLength(0);
  });
});

describe("update_page 메타·권한", () => {
  it("제목·아이콘만 바꾸면 룸은 그대로, 같은 워크스페이스 동명 페이지는 거부", async () => {
    const { ctx, fake } = setup(docOf(para("b")));
    fake.tables.pages.push({ id: "p2", workspaceId: "ws-a", title: "Taken", updatedAt: "x" });
    await expect(updatePageTool(ctx, { pageId: "p1", title: "Taken" })).rejects.toThrow(/already exists/);
    await updatePageTool(ctx, { pageId: "p1", title: "Renamed", icon: "🚀" });
    expect(savedPage(fake)).toMatchObject({ title: "Renamed", icon: "🚀" });
    expect(appended).toHaveLength(0);
  });

  it("read 전용 토큰·view 워크스페이스·토큰 범위 밖은 거부", async () => {
    const tables = baseTables();
    tables.pages = [{ id: "p1", workspaceId: "ws-a", title: "A" }, { id: "pb", workspaceId: "ws-b", title: "B" }];
    await expect(updatePageTool(makeCtx(tables).ctx, { pageId: "p1", title: "x" })).rejects.toThrow(WRITE_SCOPE_ERROR);
    await expect(updatePageTool(makeCtx(tables, WRITE).ctx, { pageId: "pb", title: "x" })).rejects.toThrow(EDIT_ACCESS_ERROR);
    await expect(updatePageTool(makeCtx(tables, { ...WRITE, workspaceIds: ["ws-b"] }).ctx, { pageId: "p1", title: "x" }))
      .rejects.toThrow(/Not found or not accessible/);
  });

  it("휴지통 페이지·풀페이지 DB 홈 본문은 수정 불가", async () => {
    await expect(updatePageTool(setup(null, { deletedAt: "2026-02-01" }).ctx, { pageId: "p1", title: "x" })).rejects.toThrow(/trash/);
    await expect(updatePageTool(setup(null, { fullPageDatabaseId: "db1" }).ctx, { pageId: "p1", content: { mode: "append", markdown: "x" } }))
      .rejects.toThrow(/full-page database/);
  });
});
