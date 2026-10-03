// Function URL 이벤트 → 인증 → Streamable HTTP(JSON) → 툴 호출까지 handler 전 구간.
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import { generateMcpToken, hashMcpToken } from "../../_shared/mcpToken";
import { createHandler, MAX_REQUEST_BODY_BYTES } from "../index";
import { createFakeDdb } from "./fakeDdb";
import { baseTables, TABLES, tokenRecord } from "./fixtures";

vi.mock("../../realtime/yjsStore", () => ({ loadPageState: vi.fn(async () => new Uint8Array([0, 0])) }));

function setup(tokenOverrides = {}) {
  const token = generateMcpToken();
  const tables = baseTables();
  tables["mcp-tokens"] = [tokenRecord({ tokenHash: hashMcpToken(token), ...tokenOverrides })];
  tables.pages = [{
    id: "p1", workspaceId: "ws-a", title: "Hello page", updatedAt: "2026-09-01",
    doc: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "body text" }] }] }),
  }];
  const fake = createFakeDdb(tables);
  const handler = createHandler({ doc: fake.doc, tables: TABLES, collabRoomEpoch: "v5" });
  return { token, handler, fake };
}

function event(body: unknown, opts: { token?: string; method?: string; path?: string } = {}): APIGatewayProxyEventV2 {
  return {
    rawPath: opts.path ?? "/mcp",
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: { http: { method: opts.method ?? "POST" }, domainName: "mcp.example.com" },
  } as unknown as APIGatewayProxyEventV2;
}

const INIT = {
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
};

describe("MCP handler e2e", () => {
  it("initialize → tools/list → tools/call(search, fetch)", async () => {
    const { token, handler } = setup();
    const init = await handler(event(INIT, { token }));
    expect(init.statusCode).toBe(200);
    expect(JSON.parse(String(init.body)).result.serverInfo.name).toBe("quicknote");

    const list = await handler(event({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { token }));
    const tools = JSON.parse(String(list.body)).result.tools.map((t: { name: string }) => t.name);
    expect(tools.sort()).toEqual(["fetch", "get_comments", "get_users", "list_workspaces", "search"]);

    const search = await handler(event({
      jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search", arguments: { query: "hello" } },
    }, { token }));
    const searchText = JSON.parse(String(search.body)).result.content[0].text;
    expect(JSON.parse(searchText).results[0]).toMatchObject({ id: "p1", match: "title" });

    const fetched = await handler(event({
      jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "fetch", arguments: { id: "p1" } },
    }, { token }));
    const fetchResult = JSON.parse(String(fetched.body)).result;
    expect(fetchResult.isError).toBeFalsy();
    expect(fetchResult.content[0].text).toContain("body text");
  });

  it("툴 오류는 isError 결과로, 입력 검증 실패도 결과로 돌려준다", async () => {
    const { token, handler } = setup({ workspaceIds: ["ws-b"] });
    const res = await handler(event({
      jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "fetch", arguments: { id: "p1" } },
    }, { token }));
    const result = JSON.parse(String(res.body)).result;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Not found or not accessible/);

    const invalid = await handler(event({
      jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "search", arguments: { query: "x", limit: 99 } },
    }, { token }));
    expect(JSON.parse(String(invalid.body)).result.isError).toBe(true);
  });

  it("인증 실패는 401 + WWW-Authenticate", async () => {
    const { handler } = setup();
    const res = await handler(event(INIT));
    expect(res.statusCode).toBe(401);
    expect(res.headers?.["www-authenticate"]).toMatch(/^Bearer/);
    expect(JSON.parse(String(res.body)).error.code).toBe(-32001);
  });

  it("GET/DELETE 는 405, 다른 경로는 404", async () => {
    const { token, handler } = setup();
    expect((await handler(event(null, { token, method: "GET" }))).statusCode).toBe(405);
    expect((await handler(event(null, { token, method: "DELETE" }))).statusCode).toBe(405);
    expect((await handler(event(INIT, { token, path: "/other" }))).statusCode).toBe(404);
  });

  it("JSON-RPC 배치는 인증·rate limit 전에 400/-32600 으로 거부", async () => {
    const { token, handler, fake } = setup();
    const batch = Array.from({ length: 100 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "tools/list" }));
    const res = await handler(event(batch, { token }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(String(res.body)).error).toEqual({ code: -32600, message: "Batch not supported" });
    expect(fake.calls).toHaveLength(0);

    const spaced = await handler({ ...event(null, { token }), body: "  \n [ {\"jsonrpc\":\"2.0\"} ]" });
    expect(spaced.statusCode).toBe(400);
    const b64 = await handler({ ...event(null, { token }), body: Buffer.from(JSON.stringify(batch)).toString("base64"), isBase64Encoded: true });
    expect(b64.statusCode).toBe(400);
  });

  it("본문 1MB 초과는 413", async () => {
    const { token, handler, fake } = setup();
    const res = await handler({ ...event(null, { token }), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "x", params: { pad: "x".repeat(MAX_REQUEST_BODY_BYTES) } }) });
    expect(res.statusCode).toBe(413);
    expect(fake.calls).toHaveLength(0);
  });

  it("분당 한도 초과 시 429", async () => {
    const { token, handler } = setup();
    let last = 200;
    for (let i = 0; i < 121; i += 1) last = Number((await handler(event(INIT, { token }))).statusCode);
    expect(last).toBe(429);
  });
});
