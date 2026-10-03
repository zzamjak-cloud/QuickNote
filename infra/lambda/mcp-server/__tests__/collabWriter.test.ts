import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { stateToDocJson } from "../../_shared/collabContent";
import { loadBodyBase, MAX_PAGE_DOC_BYTES, writePageBody } from "../collabWriter";
import { buildRowCellsUpdate } from "../dbCollabWriter";
import { appended, broadcastMock, docOf, para, publishMock, resetCollabMocks, rooms, seedRoom } from "./collabMocks";
import { baseTables, makeCtx } from "./fixtures";

vi.mock("../../realtime/yjsStore", async () => (await import("./collabMocks")).yjsStoreMock);
vi.mock("../wsBroadcast", async () => (await import("./collabMocks")).broadcastMock);
vi.mock("../../template-automation/runner", async () => (await import("./collabMocks")).publishMock);

function setup(doc: unknown) {
  const tables = baseTables();
  tables.pages = [{ id: "p1", workspaceId: "ws-a", title: "P", order: "0", updatedAt: "2026-01-01T00:00:00.000Z", doc: JSON.stringify(doc) }];
  const made = makeCtx(tables, { scopes: ["read", "write"] });
  return { ...made, page: tables.pages[0] };
}

beforeEach(() => resetCollabMocks());

describe("collabWriter.writePageBody", () => {
  it("insert: append → 브로드캐스트 → upsert materialize + publish, 체크포인트 없음", async () => {
    const original = docOf(para("one", "b1"));
    const { ctx, fake, page } = setup(original);
    seedRoom("v5:p1", original);
    const base = await loadBodyBase(ctx, page);
    const r = await writePageBody(ctx, page, base, { kind: "insert", blocks: [para("two")], at: "end" }, { patch: { title: "T2" } });
    expect(r.changed).toBe(true);
    expect(r.checkpointed).toBe(false);
    expect(appended.map((a) => a.room)).toEqual(["v5:p1"]);
    expect(broadcastMock.broadcastRoomUpdate).toHaveBeenCalledTimes(1);
    expect(publishMock.publishPageChangedToAppSync).toHaveBeenCalledTimes(1);
    const saved = fake.tables.pages[0];
    expect(saved.title).toBe("T2");
    expect(JSON.parse(String(saved.doc)).content.map((b: { content: { text: string }[] }) => b.content[0].text)).toEqual(["one", "two"]);
    // 새 블록에는 서버가 id 를 채운다(클라 UniqueID 는 원격 블록을 채우지 않는다)
    expect(typeof stateToDocJson(rooms.get("v5:p1")!).content?.[1].attrs?.id).toBe("string");
    expect(fake.tables["page-history"].some((h) => h.kind === "page.checkpoint")).toBe(false);
  });

  it("빈 본문 페이지의 replace 는 체크포인트를 남기지 않는다", async () => {
    const { ctx, page } = setup(docOf({ type: "paragraph" }));
    const base = await loadBodyBase(ctx, page);
    const r = await writePageBody(ctx, page, base, { kind: "replace", doc: docOf(para("new")) }, { checkpoint: true });
    expect(r).toMatchObject({ changed: true, checkpointed: false });
  });

  it("결과 본문이 350KB 를 넘으면 룸에 쓰기 전에 거부", async () => {
    const { ctx, page } = setup(docOf(para("x")));
    const base = await loadBodyBase(ctx, page);
    const huge = para("y".repeat(MAX_PAGE_DOC_BYTES));
    await expect(writePageBody(ctx, page, base, { kind: "insert", blocks: [huge], at: "end" })).rejects.toThrow(/max/);
    expect(appended).toHaveLength(0);
  });

  it("스키마 위반 블록은 사용자 오류", async () => {
    const { ctx, page } = setup(docOf(para("x")));
    const base = await loadBodyBase(ctx, page);
    await expect(writePageBody(ctx, page, base, { kind: "insert", blocks: [{ type: "nope" }], at: "end" })).rejects.toThrow(/Invalid content/);
  });
});

describe("dbCollabWriter.buildRowCellsUpdate", () => {
  it("빈 DB 룸은 null(서버 dbSeed 가 Pages.dbCells 로 시드), 시드된 룸은 셀 set/delete", () => {
    expect(buildRowCellsUpdate(Y.encodeStateAsUpdate(new Y.Doc()), "r1", { c: 1 })).toBeNull();
    const doc = new Y.Doc();
    const rows = new Y.Map<unknown>();
    const row = new Y.Map<unknown>();
    row.set("keep", "k");
    row.set("drop", "d");
    doc.getMap("db").set("rows", rows);
    rows.set("r1", row);
    const state = Y.encodeStateAsUpdate(doc);
    const update = buildRowCellsUpdate(state, "r1", { drop: undefined, tags: ["a"] })!;
    const merged = new Y.Doc();
    Y.applyUpdate(merged, Y.mergeUpdates([state, update]));
    expect((merged.getMap("db").get("rows") as Y.Map<Y.Map<unknown>>).get("r1")?.toJSON()).toEqual({ keep: "k", tags: ["a"] });
  });
});

describe("wsBroadcast", () => {
  const ENV = "COLLAB_WS_MANAGEMENT_ENDPOINT";
  afterEach(() => {
    delete process.env[ENV];
    vi.doUnmock("../../realtime/connections");
    vi.doUnmock("@aws-sdk/client-apigatewaymanagementapi");
    vi.resetModules();
  });

  async function loadWithMocks(targets: string[], goneIds: string[] = []) {
    const sent: { id: string; data: string }[] = [];
    const deleted: string[] = [];
    const left: string[] = [];
    vi.resetModules();
    vi.doMock("../../realtime/connections", () => ({
      roomConnections: vi.fn(async () => targets),
      leaveRoom: vi.fn(async (id: string) => void left.push(id)),
    }));
    vi.doMock("@aws-sdk/client-apigatewaymanagementapi", () => {
      class PostToConnectionCommand { constructor(public input: { ConnectionId: string; Data: Buffer }) {} }
      class DeleteConnectionCommand { constructor(public input: { ConnectionId: string }) {} }
      class ApiGatewayManagementApiClient {
        async send(cmd: PostToConnectionCommand | DeleteConnectionCommand) {
          const id = cmd.input.ConnectionId;
          if (cmd instanceof DeleteConnectionCommand) return void deleted.push(id);
          if (goneIds.includes(id)) throw Object.assign(new Error("gone"), { name: "GoneException" });
          sent.push({ id, data: (cmd as PostToConnectionCommand).input.Data.toString() });
        }
      }
      return { ApiGatewayManagementApiClient, PostToConnectionCommand, DeleteConnectionCommand };
    });
    const mod = await vi.importActual<typeof import("../wsBroadcast")>("../wsBroadcast");
    return { mod, sent, deleted, left };
  }

  it("룸의 모든 연결에 update 를 보내고, 28KB 초과는 chunk 로 분할, Gone 은 룸·연결 정리", async () => {
    process.env[ENV] = "https://ws.example.com/prod";
    const { mod, sent, deleted, left } = await loadWithMocks(["c1", "c2", "gone"], ["gone"]);
    const r = await mod.broadcastRoomUpdate("v5:p1", new Uint8Array([1, 2, 3]));
    expect(r).toEqual({ connections: 3, delivered: 2, gone: 1 });
    expect(sent.map((s) => s.id).sort()).toEqual(["c1", "c2"]);
    expect(JSON.parse(sent[0].data)).toEqual({ t: "update", update: "AQID" });
    expect(left).toEqual(["gone"]);
    expect(deleted).toEqual(["gone"]);

    sent.length = 0;
    await mod.broadcastRoomUpdate("v5:p1", new Uint8Array(40 * 1024).fill(7));
    const frames = sent.filter((s) => s.id === "c1").map((s) => JSON.parse(s.data));
    expect(frames.length).toBeGreaterThan(1);
    expect(frames.every((f) => f.t === "chunk")).toBe(true);
  });

  it("연결이 없으면 API 호출 없음, 엔드포인트 미설정이면 생략(throw 하지 않음)", async () => {
    const empty = await loadWithMocks([]);
    expect(await empty.mod.broadcastRoomUpdate("r", new Uint8Array([1]))).toEqual({ connections: 0, delivered: 0, gone: 0 });
    const noEndpoint = await loadWithMocks(["c1"]);
    const r = await noEndpoint.mod.broadcastRoomUpdate("r", new Uint8Array([1]));
    expect(r.skipped).toBe("endpoint-unavailable");
    expect(noEndpoint.sent).toHaveLength(0);
  });
});
