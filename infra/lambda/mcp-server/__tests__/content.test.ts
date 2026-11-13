import { beforeEach, describe, expect, it, vi } from "vitest";
import { stateToDocJson, type DocJson } from "../../_shared/collabContent";
import { NOT_ACCESSIBLE } from "../access";
import { createCommentTool } from "../tools/createComment";
import { setPageAppearanceTool } from "../tools/content/appearance";
import { AUTHOR_ONLY_ERROR, deleteCommentTool, toggleCommentReactionTool, updateCommentTool } from "../tools/content/comments";
import {
  getFlowchartTool, inferSides, listFlowchartHistoryTool, listFlowchartsTool, saveFlowchartTool,
} from "../tools/content/flowchart";
import { sniffImage, uploadImageTool } from "../tools/content/imageUpload";
import { getPublishStatusTool, publishPageTool, unpublishPageTool } from "../tools/content/publish";
import { createValidatingLookup, fetchPublicBytes, isBlockedAddress } from "../tools/content/urlFetch";
import {
  deleteFilterPresetTool, listDatabaseViewsTool, saveFilterPresetTool, updateDatabaseViewTool,
} from "../tools/content/views";
import { EDIT_ACCESS_ERROR, READ_ONLY_POLICY_ERROR, WRITE_SCOPE_ERROR } from "../writeAccess";
import { docOf, para, publishMock, resetCollabMocks, rooms, seedRoom } from "./collabMocks";
import { COLUMNS, readDbRoom, seedDbRoom, setupDb } from "./dbFixtures";
import type { Item } from "./fakeDdb";
import { baseTables, makeCtx } from "./fixtures";

const s3Send = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class { send = s3Send; },
  PutObjectCommand: class { constructor(public input: unknown) {} },
}));
vi.mock("../../realtime/yjsStore", async () => (await import("./collabMocks")).yjsStoreMock);
vi.mock("../wsBroadcast", async () => (await import("./collabMocks")).broadcastMock);
vi.mock("../publish", async () => (await import("./collabMocks")).publishMock);

const WRITE = { scopes: ["read", "write"] as ("read" | "write")[] };
const READ = { scopes: ["read"] as ("read" | "write")[] };
const T0 = "2026-01-01T00:00:00.000Z";
const EXTRA_TABLES = {
  PublishedPages: "published-pages", Flowcharts: "flowcharts", FlowchartHistory: "flowchart-history", ImagesBucketName: "images-bucket",
};

function page(id: string, extra: Item = {}): Item {
  return { id, workspaceId: "ws-a", title: id, order: "0", parentId: null, createdAt: T0, updatedAt: T0, doc: JSON.stringify(docOf(para(`body ${id}`, `blk-${id}`))), ...extra };
}

function setup(pages: Item[], token: object = WRITE, mutate?: (t: Record<string, Item[]>) => void) {
  const tables = baseTables();
  tables.pages = pages.map((p) => ({ ...p }));
  mutate?.(tables);
  const made = makeCtx(tables, token as never);
  made.ctx.tables = { ...made.ctx.tables, ...EXTRA_TABLES };
  return made;
}

function roomDoc(room: string): DocJson {
  return stateToDocJson(rooms.get(room) ?? new Uint8Array());
}

function dbBlock(doc: DocJson, databaseId = "db1"): DocJson | undefined {
  const walk = (n: DocJson): DocJson | undefined =>
    n.type === "databaseBlock" && n.attrs?.databaseId === databaseId ? n : (n.content ?? []).map(walk).find(Boolean);
  return walk(doc);
}

beforeEach(() => {
  resetCollabMocks();
  s3Send.mockClear();
});

describe("DB 뷰", () => {
  const HOME_PANEL = {
    filterRules: [{ id: "r1", columnId: "c-status", operator: "equals", value: "o-todo" }],
    sortRules: [{ columnId: "c-pts", dir: "desc" }],
    filterPresets: [{ id: "fp1", name: "Mine", filterRules: [], sortRules: [] }],
  };
  const homeDoc = (panel: Item = HOME_PANEL) => docOf({
    type: "databaseBlock", attrs: { id: "blk-db", databaseId: "db1", layout: "fullPage", view: "table", panelState: JSON.stringify(panel) },
  });
  const home = (panel?: Item) => page("home", { title: "Tasks", fullPageDatabaseId: "db1", doc: JSON.stringify(homeDoc(panel)) });

  it("list_database_views: 홈 블록·DB 수준 설정을 사람 값(컬럼 이름·옵션 라벨)으로 보여 준다", async () => {
    const { ctx } = setupDb({ token: READ, extraPages: [home()] });
    const r = await listDatabaseViewsTool(ctx, { databaseId: "db1" });
    expect(r.views).toHaveLength(1);
    expect(r.views[0]).toMatchObject({
      target: { pageId: "home", layout: "fullPage" }, view: "table",
      filters: [{ column: "Status", operator: "equals", value: "Todo" }],
      sorts: [{ column: "Points", direction: "desc" }],
      filterPresets: [{ id: "fp1", name: "Mine" }],
    });
    expect(r.databaseLevel.target).toBe("database");
  });

  it("list_database_views: 접근 불가 워크스페이스 DB 는 존재를 숨긴다", async () => {
    const made = setupDb({ token: READ });
    (made.fake.tables.databases[0] as Item).workspaceId = "ws-c";
    await expect(listDatabaseViewsTool(made.ctx, { databaseId: "db1" })).rejects.toThrow(NOT_ACCESSIBLE);
  });

  it("update_database_view: 홈 블록 attrs 를 페이지 룸에 쓰고, 컬럼 표시는 DB 수준에도 미러링", async () => {
    const { ctx, fake } = setupDb({ extraPages: [home()] });
    seedRoom("v5:home", homeDoc());
    seedDbRoom("db1", { columns: COLUMNS, rows: {}, order: [] });
    const r = await updateDatabaseViewTool(ctx, {
      databaseId: "db1", view: "kanban", kanbanGroupBy: "Status",
      filters: [{ column: "Tags", operator: "contains", value: "red" }], sorts: [{ column: "Due", direction: "asc" }],
      columns: [{ view: "kanban", hidden: ["Note"] }],
    });
    expect(r.writtenTo).toBe("page");
    const block = dbBlock(roomDoc("v5:home")) as DocJson;
    expect(block.attrs?.view).toBe("kanban");
    const panel = JSON.parse(String(block.attrs?.panelState));
    expect(panel.kanbanGroupColumnId).toBe("c-status");
    expect(panel.filterRules).toEqual([expect.objectContaining({ columnId: "c-tags", operator: "contains", value: "t-red" })]);
    expect(panel.sortRules).toEqual([{ columnId: "c-due", dir: "asc" }]);
    expect(panel.activePresetId).toBeNull();
    expect(panel.filterPresets).toHaveLength(1);
    expect(panel.viewConfigs.kanban.hiddenColumnIds).toEqual(["c-note"]);
    const dbPanel = readDbRoom("db1").panelState as Item;
    expect((dbPanel.viewConfigs as Item).kanban).toBeDefined();
    expect(JSON.parse(String((fake.tables.databases[0] as Item).panelState)).viewConfigs.kanban.hiddenColumnIds).toEqual(["c-note"]);
    expect(publishMock.publishDatabase).toHaveBeenCalled();
  });

  it("update_database_view: 홈 없는 DB 는 DB 룸 panelState 키만 병합, 레이아웃(view)은 거부", async () => {
    const { ctx } = setupDb();
    seedDbRoom("db1", { columns: COLUMNS, rows: {}, order: [] });
    await updateDatabaseViewTool(ctx, { databaseId: "db1", groupBy: "Status", search: "fix" });
    expect(readDbRoom("db1").panelState).toMatchObject({ groupByColumnId: "c-status", searchQuery: "fix" });
    await expect(updateDatabaseViewTool(ctx, { databaseId: "db1", view: "gallery" })).rejects.toThrow(/no page view/);
  });

  it("update_database_view: 인라인 블록(pageId) 대상, 잘못된 컬럼 타입·빈 변경은 거부", async () => {
    const inline = docOf(para("intro", "b0"), { type: "databaseBlock", attrs: { id: "blk-in", databaseId: "db1", layout: "inline", view: "table", panelState: "{}" } });
    const { ctx } = setupDb({ extraPages: [page("host", { doc: JSON.stringify(inline) })] });
    seedRoom("v5:host", inline);
    await updateDatabaseViewTool(ctx, { databaseId: "db1", pageId: "host", timelineDateColumn: "Due", view: "timeline" });
    const block = dbBlock(roomDoc("v5:host")) as DocJson;
    expect(block.attrs?.view).toBe("timeline");
    expect(JSON.parse(String(block.attrs?.panelState)).timelineDateColumnId).toBe("c-due");
    await expect(updateDatabaseViewTool(ctx, { databaseId: "db1", pageId: "host", kanbanGroupBy: "Points" })).rejects.toThrow(/cannot be used as board columns/);
    await expect(updateDatabaseViewTool(ctx, { databaseId: "db1", pageId: "host" })).rejects.toThrow(/Nothing to update/);
    await expect(updateDatabaseViewTool(ctx, { databaseId: "db1", pageId: "p-none" })).rejects.toThrow(NOT_ACCESSIBLE);
  });

  it("필터 탭: 생성(활성화)·이름으로 수정·삭제(활성 해제)", async () => {
    const { ctx } = setupDb({ extraPages: [home()] });
    seedRoom("v5:home", homeDoc());
    const created = await saveFilterPresetTool(ctx, { databaseId: "db1", name: "Done", filters: [{ column: "Status", operator: "equals", value: "Done" }] });
    const id = created.activePresetId as string;
    expect(created.filterPresets.map((p) => p.name)).toEqual(["Mine", "Done"]);
    expect(created.filterPresets[1].filters).toEqual([{ column: "Status", operator: "equals", value: "Done" }]);
    const renamed = await saveFilterPresetTool(ctx, { databaseId: "db1", presetId: "done", name: "Finished", activate: false });
    expect(renamed.filterPresets[1]).toMatchObject({ id, name: "Finished" });
    const removed = await deleteFilterPresetTool(ctx, { databaseId: "db1", presetId: id });
    expect(removed.filterPresets.map((p) => p.id)).toEqual(["fp1"]);
    expect(removed.activePresetId).toBeNull();
    await expect(deleteFilterPresetTool(ctx, { databaseId: "db1", presetId: "nope" })).rejects.toThrow(/Unknown filter tab/);
  });

  it("뷰 쓰기: read 토큰·view 권한·read 정책은 거부", async () => {
    const { ctx: readCtx } = setupDb({ token: READ, extraPages: [home()] });
    await expect(updateDatabaseViewTool(readCtx, { databaseId: "db1", search: "x" })).rejects.toThrow(WRITE_SCOPE_ERROR);
    const view = setupDb();
    (view.fake.tables.databases[0] as Item).workspaceId = "ws-b";
    await expect(saveFilterPresetTool(view.ctx, { databaseId: "db1", name: "x" })).rejects.toThrow(EDIT_ACCESS_ERROR);
    const policy = setupDb();
    (policy.fake.tables.workspaces[0] as Item).mcpPolicy = "read";
    await expect(updateDatabaseViewTool(policy.ctx, { databaseId: "db1", search: "x" })).rejects.toThrow(READ_ONLY_POLICY_ERROR);
  });
});

describe("웹 게시", () => {
  it("publish → 상태(공개 URL) → 재게시는 같은 링크 → unpublish", async () => {
    const { ctx, fake } = setup([page("p1")]);
    const published = await publishPageTool(ctx, { pageId: "p1" });
    expect(published.published).toBe(true);
    expect(published.url).toMatch(/\/p\/[A-Za-z0-9_-]{22}$/);
    expect(fake.tables["published-pages"]).toHaveLength(1);
    expect((await publishPageTool(ctx, { pageId: "p1" })).url).toBe(published.url);
    expect(await getPublishStatusTool(ctx, { pageId: "p1" })).toMatchObject({ published: true, url: published.url });
    const off = await unpublishPageTool(ctx, { pageId: "p1" });
    expect(off).toMatchObject({ published: false, url: null });
    expect((fake.tables["published-pages"][0] as Item).revokedAt).toBeTruthy();
    expect((await getPublishStatusTool(ctx, { pageId: "p1" })).published).toBe(false);
  });

  it("거부: read 토큰·view 권한·DB 행·미구성 서버, 접근 불가 상태 조회", async () => {
    const { ctx: readCtx } = setup([page("p1")], READ);
    await expect(publishPageTool(readCtx, { pageId: "p1" })).rejects.toThrow(WRITE_SCOPE_ERROR);
    const { ctx } = setup([page("pb", { workspaceId: "ws-b" }), page("row", { databaseId: "db1" }), page("pc", { workspaceId: "ws-c" })]);
    await expect(publishPageTool(ctx, { pageId: "pb" })).rejects.toThrow(EDIT_ACCESS_ERROR);
    await expect(publishPageTool(ctx, { pageId: "row" })).rejects.toThrow(/게시할 수 없습니다/);
    await expect(getPublishStatusTool(ctx, { pageId: "pc" })).rejects.toThrow(NOT_ACCESSIBLE);
    const bare = makeCtx(baseTables(), WRITE as never);
    bare.fake.tables.pages.push(page("p1"));
    await expect(publishPageTool(bare.ctx, { pageId: "p1" })).rejects.toThrow(/not configured/);
  });
});

describe("플로우차트", () => {
  const NODES = [
    { id: "a", label: "Start", shape: "terminator" as const, x: 0, y: 0 },
    { id: "b", label: "Done?", shape: "diamond" as const, x: 0, y: 160 },
    { id: "c", label: "Ship", x: 240, y: 160, link: { type: "page" as const, pageId: "p1" } },
  ];
  const EDGES = [{ from: "a", to: "b" }, { from: "b", to: "c", label: "yes" }];

  it("새로 저장(+페이지 끝 블록 삽입·버전) → 조회 → 같은 내용 재저장은 버전 생략 → 목록·히스토리", async () => {
    const { ctx, fake } = setup([page("p1")]);
    seedRoom("v5:p1", docOf(para("body p1", "blk-p1")));
    const saved = await saveFlowchartTool(ctx, { workspaceId: "ws-a", title: "Flow", nodes: NODES, edges: EDGES, appendToPageId: "p1" });
    expect(saved).toMatchObject({ created: true, nodes: 3, edges: 2, versionSaved: true, insertedIntoPageId: "p1" });
    const blocks = roomDoc("v5:p1").content ?? [];
    expect(blocks[blocks.length - 1]).toMatchObject({ type: "flowchartBlock", attrs: { flowchartId: saved.flowchartId, title: "Flow" } });
    const got = await getFlowchartTool(ctx, { flowchartId: saved.flowchartId });
    expect(got.edges).toEqual([
      expect.objectContaining({ from: "a", to: "b", fromSide: "bottom", toSide: "top" }),
      expect.objectContaining({ from: "b", to: "c", fromSide: "right", toSide: "left", label: "yes" }),
    ]);
    expect(got.nodes[2]).toMatchObject({ shape: "rectangle", link: { type: "page", pageId: "p1" } });
    const again = await saveFlowchartTool(ctx, { flowchartId: saved.flowchartId, nodes: NODES, edges: EDGES });
    expect(again).toMatchObject({ created: false, versionSaved: false, title: "Flow" });
    expect(fake.tables["flowchart-history"]).toHaveLength(1);
    expect((await listFlowchartsTool(ctx, { workspaceId: "ws-a" })).flowcharts).toEqual([expect.objectContaining({ id: saved.flowchartId, nodes: 3 })]);
    expect((await listFlowchartHistoryTool(ctx, { flowchartId: saved.flowchartId })).versions).toHaveLength(1);
  });

  it("거부: read 토큰·view 권한 저장, 접근 불가 조회, 없는 노드 참조", async () => {
    const { ctx: readCtx } = setup([], READ);
    await expect(saveFlowchartTool(readCtx, { workspaceId: "ws-a", nodes: NODES })).rejects.toThrow(WRITE_SCOPE_ERROR);
    const { ctx } = setup([], WRITE, (t) => {
      t.flowcharts = [{ id: "fc", workspaceId: "ws-c", title: "x", data: "{}", updatedAt: T0 }, { id: "fb", workspaceId: "ws-b", title: "y", data: "{}", updatedAt: T0 }];
    });
    await expect(getFlowchartTool(ctx, { flowchartId: "fc" })).rejects.toThrow(NOT_ACCESSIBLE);
    await expect(saveFlowchartTool(ctx, { flowchartId: "fb", nodes: NODES })).rejects.toThrow(EDIT_ACCESS_ERROR);
    await expect(saveFlowchartTool(ctx, { workspaceId: "ws-a", nodes: NODES, edges: [{ from: "a", to: "zz" }] })).rejects.toThrow(/unknown node/);
  });

  it("핸들 추론: 세로가 크면 위·아래, 가로가 크면 좌·우", () => {
    const n = (x: number, y: number) => ({ id: "n", type: "shape" as const, position: { x, y }, data: { label: "", shape: "rectangle" as const } });
    expect(inferSides(n(0, 0), n(0, -100))).toEqual(["top", "bottom"]);
    expect(inferSides(n(0, 0), n(-300, 10))).toEqual(["left", "right"]);
  });
});

describe("댓글 답글·수정·삭제·리액션", () => {
  function withComments(token: object = WRITE) {
    return setup([page("p1"), page("pb", { workspaceId: "ws-b" })], token, (t) => {
      t.comments = [
        { id: "c1", workspaceId: "ws-a", pageId: "p1", blockId: "blk-p1", authorMemberId: "m1", bodyText: "root", mentionMemberIds: "[]", reactions: "[]", parentId: null, createdAt: T0, updatedAt: T0 },
        { id: "c2", workspaceId: "ws-a", pageId: "p1", blockId: "blk-p1", authorMemberId: "m2", bodyText: "reply", mentionMemberIds: "[]", reactions: "[]", parentId: "c1", createdAt: T0, updatedAt: T0 },
        { id: "cb", workspaceId: "ws-b", pageId: "pb", blockId: "blk-pb", authorMemberId: "m1", bodyText: "b", mentionMemberIds: "[]", reactions: "[]", createdAt: T0, updatedAt: T0 },
      ];
    });
  }

  it("create_comment parentId: 스레드 루트·부모 블록으로 답글", async () => {
    const { ctx, fake } = withComments();
    const r = await createCommentTool(ctx, { pageId: "p1", text: "thanks", parentId: "c2" });
    expect(r).toMatchObject({ parentId: "c1", blockId: "blk-p1" });
    expect(fake.tables.comments.find((c) => c.id === r.id)).toMatchObject({ parentId: "c1", blockId: "blk-p1", bodyText: "thanks" });
    await expect(createCommentTool(ctx, { pageId: "p1", text: "x", parentId: "cb" })).rejects.toThrow(/not accessible/);
  });

  it("update_comment: 본인 댓글만, 앵커·스레드 유지 + 발행", async () => {
    const { ctx, fake } = withComments();
    await updateCommentTool(ctx, { commentId: "c1", text: "edited" });
    expect(fake.tables.comments.find((c) => c.id === "c1")).toMatchObject({ bodyText: "edited", blockId: "blk-p1", createdAt: T0, parentId: null });
    expect(publishMock.publishComment).toHaveBeenCalled();
    await expect(updateCommentTool(ctx, { commentId: "c2", text: "x" })).rejects.toThrow(AUTHOR_ONLY_ERROR);
  });

  it("delete_comment: soft delete + deletedAt 발행, 삭제된 댓글은 숨김", async () => {
    const { ctx, fake } = withComments();
    const r = await deleteCommentTool(ctx, { commentId: "c1" });
    expect(fake.tables.comments.find((c) => c.id === "c1")?.deletedAt).toBe(r.deletedAt);
    expect(publishMock.publishComment).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }), { deletedAt: r.deletedAt });
    await expect(deleteCommentTool(ctx, { commentId: "c1" })).rejects.toThrow(NOT_ACCESSIBLE);
    await expect(deleteCommentTool(ctx, { commentId: "c2" })).rejects.toThrow(AUTHOR_ONLY_ERROR);
  });

  it("toggle_comment_reaction: 생략 시 토글, 다른 사람 댓글에도 가능", async () => {
    const { ctx } = withComments();
    const on = await toggleCommentReactionTool(ctx, { commentId: "c2", emoji: "👍" });
    expect(on.reacted).toBe(true);
    expect(on.reactions).toEqual([{ kind: "emoji", value: "👍", memberIds: ["m1"] }]);
    const off = await toggleCommentReactionTool(ctx, { commentId: "c2", emoji: "👍" });
    expect(off.reacted).toBe(false);
    expect(off.reactions).toEqual([]);
  });

  it("거부: read 토큰·view 권한 워크스페이스", async () => {
    const { ctx: readCtx } = withComments(READ);
    await expect(toggleCommentReactionTool(readCtx, { commentId: "c1", emoji: "👍" })).rejects.toThrow(WRITE_SCOPE_ERROR);
    const { ctx } = withComments();
    await expect(updateCommentTool(ctx, { commentId: "cb", text: "x" })).rejects.toThrow(EDIT_ACCESS_ERROR);
  });
});

describe("페이지 표지·제목 색", () => {
  it("업로드 자산·https 표지와 제목 색 설정·제거", async () => {
    const { ctx, fake } = setup([page("p1")], WRITE, (t) => {
      t["image-assets"] = [{ id: "asset-abc", ownerId: "sub-1", status: "READY" }];
    });
    const r = await setPageAppearanceTool(ctx, { pageId: "p1", cover: "quicknote-image://asset-abc", titleColor: "#2563eb" });
    expect(r).toMatchObject({ cover: "quicknote-image://asset-abc", titleColor: "#2563eb" });
    expect(fake.tables.pages.find((p) => p.id === "p1")).toMatchObject({ coverImage: "quicknote-image://asset-abc", titleColor: "#2563eb" });
    expect(publishMock.publishPage).toHaveBeenCalled();
    const cleared = await setPageAppearanceTool(ctx, { pageId: "p1", cover: null, titleColor: null });
    expect(cleared).toMatchObject({ cover: null, titleColor: null });
    await setPageAppearanceTool(ctx, { pageId: "p1", cover: "https://images.example.com/c.jpg" });
  });

  it("거부: 없는 자산·잘못된 값·빈 변경·view 권한", async () => {
    const { ctx } = setup([page("p1"), page("pb", { workspaceId: "ws-b" })]);
    await expect(setPageAppearanceTool(ctx, { pageId: "p1", cover: "quicknote-image://asset-none" })).rejects.toThrow(/upload_image/);
    await expect(setPageAppearanceTool(ctx, { pageId: "p1", cover: "javascript:alert(1)" })).rejects.toThrow();
    await expect(setPageAppearanceTool(ctx, { pageId: "p1", titleColor: "red;x" })).rejects.toThrow();
    await expect(setPageAppearanceTool(ctx, { pageId: "p1" })).rejects.toThrow(/Nothing to update/);
    await expect(setPageAppearanceTool(ctx, { pageId: "pb", titleColor: "#ef4444" })).rejects.toThrow(EDIT_ACCESS_ERROR);
  });
});

describe("이미지 업로드", () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fake-png-body")]);

  it("base64 → S3 PUT·READY 자산·provisional 사용처, 같은 바이트는 재사용", async () => {
    const { ctx, fake } = setup([]);
    const r = await uploadImageTool(ctx, { workspaceId: "ws-a", data: `data:image/png;base64,${PNG.toString("base64")}`, alt: "diagram" });
    expect(r.ref).toBe(`quicknote-image://${r.assetId}`);
    expect(r.markdown).toBe(`![diagram](${r.ref})`);
    expect(r).toMatchObject({ mimeType: "image/png", size: PNG.length, reused: false });
    expect(s3Send).toHaveBeenCalledTimes(1);
    const put = (s3Send.mock.calls[0] as unknown as [{ input: Item }])[0].input;
    expect(put).toMatchObject({ Bucket: "images-bucket", Key: `users/sub-1/images/${r.assetId}.png`, ContentType: "image/png" });
    expect(fake.tables["image-assets"].find((a) => a.id === r.assetId)).toMatchObject({ ownerId: "sub-1", status: "READY" });
    expect(fake.tables["asset-usage"]).toEqual([expect.objectContaining({ assetId: r.assetId, sk: "WS#ws-a#PROVISIONAL", provisional: true })]);
    const again = await uploadImageTool(ctx, { workspaceId: "ws-a", data: PNG.toString("base64") });
    expect(again).toMatchObject({ assetId: r.assetId, reused: true });
    expect(s3Send).toHaveBeenCalledTimes(1);
  });

  it("거부: 비이미지·둘 다/둘 다 없음·사설 주소 URL·read 토큰·view 권한", async () => {
    const { ctx } = setup([]);
    await expect(uploadImageTool(ctx, { workspaceId: "ws-a", data: Buffer.from("<svg/>").toString("base64") })).rejects.toThrow(/Unsupported image format/);
    await expect(uploadImageTool(ctx, { workspaceId: "ws-a" })).rejects.toThrow(/exactly one/);
    await expect(uploadImageTool(ctx, { workspaceId: "ws-a", url: "http://127.0.0.1/a.png" })).rejects.toThrow(/public internet address/);
    await expect(uploadImageTool(ctx, { workspaceId: "ws-a", url: "file:///etc/passwd" })).rejects.toThrow(/http\(s\)/);
    await expect(uploadImageTool(ctx, { workspaceId: "ws-b", data: PNG.toString("base64") })).rejects.toThrow(EDIT_ACCESS_ERROR);
    const { ctx: readCtx } = setup([], READ);
    await expect(uploadImageTool(readCtx, { workspaceId: "ws-a", data: PNG.toString("base64") })).rejects.toThrow(WRITE_SCOPE_ERROR);
    expect(s3Send).not.toHaveBeenCalled();
  });

  it("형식 판정·주소 차단 규칙", () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mimeType).toBe("image/jpeg");
    expect(sniffImage(Buffer.from("GIF89a...."))?.mimeType).toBe("image/gif");
    expect(sniffImage(Buffer.from("RIFF0000WEBPVP8 "))?.mimeType).toBe("image/webp");
    for (const ip of ["10.0.0.1", "169.254.169.254", "172.20.1.1", "192.168.0.1", "::1", "fd00::1", "::ffff:127.0.0.1", "100.64.0.1"]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
  });

  it("IPv6 우회 표기(매핑·호환·NAT64·6to4·site-local 등)도 차단", () => {
    const bypasses = [
      "[::ffff:7f00:1]", "::ffff:7f00:1", "::7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1", "2002:7f00:1::",
      "fec0::1", "::", "fe80::1", "ff02::1", "100::1", "2001:db8::1", "::ffff:8.8.8.8", "255.255.255.255", "0.0.0.0", "not-an-ip",
    ];
    for (const ip of bypasses) expect(isBlockedAddress(ip), ip).toBe(true);
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedAddress("1.1.1.1")).toBe(false);
  });

  it("URL 의 IPv6 리터럴 우회 표기 거부", async () => {
    for (const host of ["[::ffff:127.0.0.1]", "[::7f00:1]", "[::ffff:a9fe:a9fe]", "[64:ff9b::7f00:1]", "[2002:7f00:1::]", "[fec0::1]"]) {
      await expect(fetchPublicBytes(`http://${host}/a.png`, 1024)).rejects.toThrow(/public internet address/);
    }
    await expect(fetchPublicBytes("http://2130706433/a.png", 1024)).rejects.toThrow(/public internet address/);
  });

  it("DNS 리바인딩: 사전 검사 후 연결 시점 재조회가 사설 주소면 연결하지 않는다", async () => {
    const resolver = vi.fn()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(fetchPublicBytes("http://rebind.example/a.png", 1024, resolver)).rejects.toThrow(/public internet address/);
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("검증 lookup: 사설 주소가 하나라도 섞이면 거부, 공인이면 그 주소로 고정", async () => {
    const call = (addresses: { address: string; family: number }[], all = false) =>
      new Promise<unknown>((resolve, reject) => {
        createValidatingLookup(async () => addresses)("h.example", { all }, (err: unknown, addr: unknown) => (err ? reject(err) : resolve(addr)));
      });
    await expect(call([{ address: "1.1.1.1", family: 4 }, { address: "::ffff:7f00:1", family: 6 }])).rejects.toThrow(/public internet address/);
    expect(await call([{ address: "1.1.1.1", family: 4 }])).toBe("1.1.1.1");
    expect(await call([{ address: "1.1.1.1", family: 4 }], true)).toEqual([{ address: "1.1.1.1", family: 4 }]);
  });
});
