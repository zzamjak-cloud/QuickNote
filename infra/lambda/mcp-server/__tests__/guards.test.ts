import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EPOCH_CACHE_TTL_MS, observedEpochs, requireCollabEpoch } from "../epochGuard";
import { consumeDailyWrite, dailyWriteLimit } from "../rateLimit";
import { createCommentTool } from "../tools/createComment";
import { updatePageTool } from "../tools/updatePage";
import { beginWrite, WRITE_SCOPE_ERROR } from "../writeAccess";
import { docOf, para, resetCollabMocks } from "./collabMocks";
import { baseTables, makeCtx } from "./fixtures";
import type { Item } from "./fakeDdb";

vi.mock("../../realtime/yjsStore", async () => (await import("./collabMocks")).yjsStoreMock);
vi.mock("../wsBroadcast", async () => (await import("./collabMocks")).broadcastMock);
vi.mock("../../template-automation/runner", async () => (await import("./collabMocks")).publishMock);

const WRITE = { scopes: ["read", "write"] as ("read" | "write")[] };
const ENV = { YDOC_UPDATES_TABLE: "rt-upd", YDOC_TABLE: "rt-ydoc", CONNECTIONS_TABLE: "rt-conn" };

function setup(rooms: { updates?: string[]; ydoc?: string[]; conns?: string[] }) {
  const tables = baseTables();
  tables.pages = [{ id: "p1", workspaceId: "ws-a", title: "P", order: "0", updatedAt: "x", doc: JSON.stringify(docOf(para("b", "blk"))) }];
  tables["rt-upd"] = (rooms.updates ?? []).map((pageId, i) => ({ pageId, seq: String(i) }));
  tables["rt-ydoc"] = (rooms.ydoc ?? []).map((pageId) => ({ pageId }));
  tables["rt-conn"] = (rooms.conns ?? []).map((pageId, i) => ({ connectionId: `c${i}`, pageId }));
  return makeCtx(tables, WRITE);
}

const scans = (fake: ReturnType<typeof setup>["fake"]) => fake.calls.filter((c) => c.constructor.name === "ScanCommand");

beforeEach(() => {
  resetCollabMocks();
  Object.assign(process.env, ENV);
});
afterEach(() => {
  for (const k of Object.keys(ENV)) delete process.env[k];
  delete process.env.MCP_DAILY_WRITE_LIMIT;
});

describe("epoch 불일치 가드", () => {
  it("서버 epoch 이 최신이고 활성 연결도 서버 epoch 이면 허용(옛 세대 잔재는 무시)", async () => {
    const { ctx } = setup({ updates: ["v4:old", "v5:p9"], ydoc: ["v3:x"], conns: ["db:v5:d1"] });
    await expect(requireCollabEpoch(ctx)).resolves.toBeUndefined();
  });

  it("H1: 옛 epoch 룸이 남아 있어도 클라가 더 높은 epoch 을 쓰면 거부(서버가 옛 값)", async () => {
    const { ctx } = setup({ updates: ["v5:legacy", "v6:a"], ydoc: ["v5:b"], conns: ["v6:b"] });
    await expect(requireCollabEpoch(ctx)).rejects.toThrow(/EPOCH_MISMATCH: server collab epoch "v5" — newer epoch v6/);
  });

  it("활성 연결이 있는데 서버 epoch 연결이 하나도 없으면 거부", async () => {
    const { ctx } = setup({ updates: ["v5:a"], conns: ["v4:old-tab"] });
    await expect(requireCollabEpoch(ctx)).rejects.toThrow(/no active connection uses the server epoch.*active connections: v4/);
  });

  it("활성 연결이 없고 저장 룸이 서버 epoch 이하면 허용, 표본이 비면 허용", async () => {
    await expect(requireCollabEpoch(setup({ updates: ["v4:a", "v5:b"] }).ctx)).resolves.toBeUndefined();
    resetCollabMocks();
    await expect(requireCollabEpoch(setup({}).ctx)).resolves.toBeUndefined();
  });

  it("불일치 시 본문·셀 쓰기만 거부하고 메타·댓글은 허용", async () => {
    const { ctx, fake } = setup({ updates: ["v6:a"], conns: ["v6:b"] });
    await expect(updatePageTool(ctx, { pageId: "p1", content: { mode: "append", markdown: "x" } })).rejects.toThrow(/EPOCH_MISMATCH/);
    await updatePageTool(ctx, { pageId: "p1", title: "Renamed" });
    await createCommentTool(ctx, { pageId: "p1", text: "hi" });
    expect((fake.tables.pages.find((p) => p.id === "p1") as Item).title).toBe("Renamed");
  });

  it("표본은 컨테이너 캐시(TTL 10분) — 키만 projection, Limit 100", async () => {
    const { ctx, fake } = setup({ updates: ["v5:a"] });
    await observedEpochs(ctx.doc, 1_000);
    await observedEpochs(ctx.doc, 1_000 + EPOCH_CACHE_TTL_MS - 1);
    expect(scans(fake)).toHaveLength(3);
    expect(scans(fake)[0].input).toMatchObject({ Limit: 100, ProjectionExpression: "#r" });
    await observedEpochs(ctx.doc, 1_000 + EPOCH_CACHE_TTL_MS);
    expect(scans(fake)).toHaveLength(6);
  });

  it("표본 조회 실패는 캐시하지 않고 쓰기를 거부", async () => {
    const { ctx } = setup({});
    const failing = { ...ctx, doc: { send: vi.fn().mockRejectedValue(new Error("AccessDenied")) } as unknown as typeof ctx.doc };
    await expect(requireCollabEpoch(failing)).rejects.toThrow(/EPOCH_CHECK_FAILED/);
    await expect(requireCollabEpoch(ctx)).resolves.toBeUndefined();
  });
});

describe("일일 쓰기 상한", () => {
  it("토큰·UTC 날짜별 원자 카운터, 초과 시 다음 UTC 자정 안내, TTL 2일", async () => {
    const { ctx, fake } = setup({});
    const now = Date.parse("2026-10-03T15:00:00.000Z");
    const args = { doc: ctx.doc, tableName: ctx.tables.RateLimit, tokenId: "tok-1", limit: 2, nowMs: now };
    expect(await consumeDailyWrite(args)).toEqual({ ok: true });
    expect(await consumeDailyWrite(args)).toEqual({ ok: true });
    expect(await consumeDailyWrite(args)).toEqual({ ok: false, limit: 2, resetAt: "2026-10-04T00:00:00.000Z" });
    const update = fake.calls.find((c) => c.constructor.name === "UpdateCommand")!.input;
    expect(update.Key).toEqual({ pk: "mcp-wd#tok-1#2026-10-03", sk: "writes" });
    expect((update.ExpressionAttributeValues as Item)[":exp"]).toBe(Math.floor(now / 1000) + 172_800);
    // 다음 날은 새 카운터
    expect(await consumeDailyWrite({ ...args, nowMs: now + 9 * 3600_000 })).toEqual({ ok: true });
  });

  it("env 로 상한 조정, beginWrite 는 페이지 수만큼 차감·초과 시 툴 오류·read 토큰은 카운터를 올리지 않음", async () => {
    expect(dailyWriteLimit()).toBe(500);
    process.env.MCP_DAILY_WRITE_LIMIT = "1";
    expect(dailyWriteLimit()).toBe(1);
    const { ctx, fake } = setup({});
    await beginWrite(ctx);
    await expect(beginWrite(ctx)).rejects.toThrow(/Daily write limit reached \(1 .*Resets at \d{4}-\d{2}-\d{2}T00:00:00.000Z/);
    await expect(beginWrite({ ...ctx, token: { ...ctx.token, tokenId: "tok-2" } }, 2)).rejects.toThrow(/Daily write limit/);
    const readOnly = makeCtx(baseTables(), { scopes: ["read"] });
    await expect(beginWrite(readOnly.ctx)).rejects.toThrow(WRITE_SCOPE_ERROR);
    expect(readOnly.fake.calls).toHaveLength(0);
    expect(fake.calls.filter((c) => c.constructor.name === "UpdateCommand")).toHaveLength(3);
  });
});
