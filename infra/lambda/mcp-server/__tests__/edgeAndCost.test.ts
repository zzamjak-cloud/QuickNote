// P4-B: 원본 보호·공개 origin(SSM)·뷰어 IP, 메타 캐시(TTL·무효화), get_comments 페이지 GSI, search 본문 읽기량 상한.
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateMcpToken, hashMcpToken } from "../../_shared/mcpToken";
import { createHandler, ORIGIN_VERIFY_HEADER } from "../index";
import { oauthConfigFromEnv, primePublicOrigin, resetPublicOriginCache } from "../oauth/config";
import { clientIp } from "../oauth/http";
import { META_CACHE_TTL_MS, scanWorkspaceMetas, type PageMeta } from "../pageScan";
import { getCommentsTool } from "../tools/comments";
import { fetchTool } from "../tools/fetch";
import { findBodyHits } from "../tools/search";
import { updatePageTool } from "../tools/updatePage";
import { docOf, para, resetCollabMocks } from "./collabMocks";
import { createFakeDdb, type Item } from "./fakeDdb";
import { baseTables, makeCtx, TABLES, tokenRecord } from "./fixtures";

vi.mock("../../realtime/yjsStore", async () => (await import("./collabMocks")).yjsStoreMock);
vi.mock("../wsBroadcast", async () => (await import("./collabMocks")).broadcastMock);
vi.mock("../publish", async () => (await import("./collabMocks")).publishMock);

function event(headers: Record<string, string> = {}, path = "/mcp"): APIGatewayProxyEventV2 {
  return {
    rawPath: path, rawQueryString: "", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }), isBase64Encoded: false,
    requestContext: { http: { method: "POST", sourceIp: "10.0.0.1" }, domainName: "abc.lambda-url.ap-northeast-2.on.aws" },
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  resetCollabMocks();
  resetPublicOriginCache();
});
afterEach(() => {
  delete process.env.MCP_PUBLIC_ORIGIN_PARAM;
  delete process.env.MCP_PUBLIC_ORIGIN;
});

describe("원본 보호(origin-verify)", () => {
  it("ORIGIN_VERIFY 가 있으면 헤더 불일치·누락은 403, 일치하면 처리(여기선 무토큰 401)", async () => {
    const fake = createFakeDdb(baseTables());
    const handler = createHandler({ doc: fake.doc, tables: TABLES, collabRoomEpoch: "v5", originVerify: "s3cret", oauth: { config: oauthConfigFromEnv() } });
    expect((await handler(event())).statusCode).toBe(403);
    expect((await handler(event({ [ORIGIN_VERIFY_HEADER]: "wrong!" }))).statusCode).toBe(403);
    expect((await handler(event({ [ORIGIN_VERIFY_HEADER]: "s3cret" }))).statusCode).toBe(401);
    expect(fake.calls).toHaveLength(0); // 403 은 DDB 를 건드리지 않는다
  });

  it("ORIGIN_VERIFY 미설정이면 검사하지 않는다(로컬·테스트)", async () => {
    const token = generateMcpToken();
    const tables = baseTables();
    tables["mcp-tokens"] = [tokenRecord({ tokenHash: hashMcpToken(token) })];
    const handler = createHandler({ doc: createFakeDdb(tables).doc, tables: TABLES, collabRoomEpoch: "v5", originVerify: "", oauth: { config: oauthConfigFromEnv() } });
    expect((await handler(event({ authorization: `Bearer ${token}` }))).statusCode).toBe(200);
  });
});

describe("공개 origin(SSM)·뷰어 IP", () => {
  it("MCP_PUBLIC_ORIGIN_PARAM 을 한 번 읽어 캐시하고 OAuth config 의 publicOrigin 이 된다", async () => {
    process.env.MCP_PUBLIC_ORIGIN_PARAM = "/dev-quicknote/mcp-public-origin";
    const read = vi.fn(async () => "https://d111.cloudfront.net/");
    expect(await primePublicOrigin(read)).toBe(true);
    expect(await primePublicOrigin(read)).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(oauthConfigFromEnv().publicOrigin).toBe("https://d111.cloudfront.net");
  });

  it("파라미터를 못 읽으면 false(캐시하지 않음) — 핸들러는 503 으로 거절", async () => {
    process.env.MCP_PUBLIC_ORIGIN_PARAM = "/x";
    expect(await primePublicOrigin(async () => { throw new Error("AccessDenied"); })).toBe(false);
    expect(await primePublicOrigin(async () => "https://ok.cloudfront.net")).toBe(true);
  });

  it("뷰어 IP: CloudFront 경유(publicOrigin)일 때만 x-qn-viewer-address → CloudFront-Viewer-Address 순으로 신뢰", () => {
    const viaEdge = event({ "x-qn-viewer-address": "2001:db8::1:0", "cloudfront-viewer-address": "198.51.100.2:443" });
    expect(clientIp(viaEdge, { publicOrigin: "https://d.cloudfront.net" })).toBe("2001:db8::1");
    expect(clientIp(event({ "cloudfront-viewer-address": "198.51.100.2:443" }), { publicOrigin: "https://d" })).toBe("198.51.100.2");
    expect(clientIp(viaEdge, {})).toBe("10.0.0.1"); // 직접 호출 구성에서는 헤더를 믿지 않는다
  });
});

describe("워크스페이스 메타 캐시", () => {
  const metaQueries = (fake: ReturnType<typeof makeCtx>["fake"]) =>
    fake.calls.filter((c) => c.constructor.name === "QueryCommand" && c.input.IndexName === "byWorkspaceMetaUpdatedAt").length;

  function setup() {
    const tables = baseTables();
    tables.pages = [
      { id: "p1", workspaceId: "ws-a", title: "One", order: "0", updatedAt: "2026-01-01T00:00:00.000Z", doc: JSON.stringify(docOf(para("x"))) },
      { id: "c1", workspaceId: "ws-a", title: "Child", parentId: "p1", order: "0", updatedAt: "2026-01-01T00:00:00.000Z" },
    ];
    return makeCtx(tables, { scopes: ["read", "write"] });
  }

  it("TTL(30초) 안의 fetch 는 같은 스캔을 재사용, 지나면 다시 읽는다", async () => {
    const { ctx, fake } = setup();
    await fetchTool(ctx, { id: "p1" });
    await fetchTool(ctx, { id: "p1" });
    expect(metaQueries(fake)).toBe(1);
    const args = { doc: ctx.doc, pagesTable: TABLES.Pages, workspaceId: "ws-a", budget: 5000 };
    await scanWorkspaceMetas({ ...args, nowMs: Date.now() + META_CACHE_TTL_MS - 1000 });
    expect(metaQueries(fake)).toBe(1);
    await scanWorkspaceMetas({ ...args, nowMs: Date.now() + META_CACHE_TTL_MS + 1000 });
    expect(metaQueries(fake)).toBe(2);
  });

  it("쓰기 툴이 실행되면 그 워크스페이스 캐시를 무효화한다", async () => {
    const { ctx, fake } = setup();
    expect(await fetchTool(ctx, { id: "p1" })).toContain("Child");
    await updatePageTool(ctx, { pageId: "c1", title: "Renamed child" });
    const before = metaQueries(fake);
    expect(await fetchTool(ctx, { id: "p1" })).toContain("Renamed child");
    expect(metaQueries(fake)).toBe(before + 1);
  });

  it("작은 예산으로 잘린 결과는 더 큰 예산 요청에 재사용하지 않는다", async () => {
    const { ctx, fake } = setup();
    const args = { doc: ctx.doc, pagesTable: TABLES.Pages, workspaceId: "ws-a" };
    expect((await scanWorkspaceMetas({ ...args, budget: 1 })).truncated).toBe(true);
    expect((await scanWorkspaceMetas({ ...args, budget: 5000 })).metas).toHaveLength(2);
    expect(metaQueries(fake)).toBe(2);
  });
});

describe("get_comments — 페이지 GSI", () => {
  function setup() {
    const tables = baseTables();
    tables.pages = [{ id: "p1", workspaceId: "ws-a", title: "P" }];
    tables.comments = [
      { id: "k1", workspaceId: "ws-a", pageId: "p1", blockId: "b", authorMemberId: "m1", bodyText: "hi", createdAt: "2026-01-02T00:00:00.000Z" },
      { id: "k0", workspaceId: "ws-a", pageId: "p1", blockId: "b", authorMemberId: "m2", bodyText: "first", createdAt: 1767225600000 },
      { id: "x", workspaceId: "ws-c", pageId: "p1", blockId: "b", authorMemberId: "m2", bodyText: "other ws", createdAt: "2026-01-03" },
    ];
    return makeCtx(tables);
  }

  it("byPageId GSI 로 그 페이지만 읽고(다른 워크스페이스 제외), 숫자 createdAt 레거시도 정렬해 포함", async () => {
    const { ctx, fake } = setup();
    const r = await getCommentsTool(ctx, { pageId: "p1" });
    expect(r.comments.map((c) => c.body)).toEqual(["first", "hi"]);
    const indexes = fake.calls.filter((c) => c.constructor.name === "QueryCommand" && c.input.TableName === TABLES.Comments).map((c) => c.input.IndexName);
    expect(indexes).toEqual(["byPageId"]);
  });

  it("GSI 가 아직 없으면(ValidationException) 워크스페이스 GSI 로 폴백", async () => {
    const { ctx, fake } = setup();
    const send = fake.doc.send.bind(fake.doc);
    fake.doc.send = (async (cmd: { constructor: { name: string }; input: Item }) => {
      if (cmd.input.IndexName === "byPageId") throw Object.assign(new Error("The table does not have the specified index"), { name: "ValidationException" });
      return send(cmd as never);
    }) as typeof fake.doc.send;
    const r = await getCommentsTool(ctx, { pageId: "p1" });
    expect(r.comments.map((c) => c.body)).toEqual(["first", "hi"]);
  });
});

describe("search 본문 읽기량 상한", () => {
  it("상한에 닿으면 다음 묶음을 읽지 않고 capped 로 알린다", async () => {
    const big = "x".repeat(50_000);
    const tables = baseTables();
    const metas: PageMeta[] = [];
    tables.pages = Array.from({ length: 100 }, (_, i) => {
      metas.push({ id: `p${i}`, workspaceId: "ws-a", title: `P${i}`, parentId: null, databaseId: null, updatedAt: "x", deleted: false, order: i });
      return { id: `p${i}`, workspaceId: "ws-a", doc: JSON.stringify(docOf(para(i === 99 ? "needle" : big))) };
    });
    const { ctx } = makeCtx(tables);
    const capped = await findBodyHits(ctx, metas, "needle", 5, 1_500_000);
    expect(capped.capped).toBe(true);
    expect(capped.searched).toBeLessThan(100);
    expect(capped.hits).toHaveLength(0);
    const full = await findBodyHits(ctx, metas, "needle", 5);
    expect(full).toMatchObject({ capped: false, searched: 100 });
    expect(full.hits.map((h) => h.meta.id)).toEqual(["p99"]);
  });
});
