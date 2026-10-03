// Function URL 이벤트 → 인증 → Streamable HTTP(JSON) → 툴 호출까지 handler 전 구간.
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import { generateMcpToken, hashMcpToken } from "../../_shared/mcpToken";
import { createHandler, MAX_REQUEST_BODY_BYTES } from "../index";
import { createFakeDdb } from "./fakeDdb";
import { baseTables, TABLES, tokenRecord } from "./fixtures";

vi.mock("../../realtime/yjsStore", async () => (await import("./collabMocks")).yjsStoreMock);
vi.mock("../wsBroadcast", async () => (await import("./collabMocks")).broadcastMock);
vi.mock("../publish", async () => (await import("./collabMocks")).publishMock);

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
    expect(tools.sort()).toEqual([
      "create_comment", "create_database", "create_pages", "duplicate_page", "fetch", "get_comments", "get_users",
      "list_workspaces", "move_pages", "query_database", "search", "trash_page", "update_database", "update_page",
    ]);

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

  it("쓰기 왕복: create_pages → update_page(append·replace_range) → fetch, read 토큰은 isError", async () => {
    const { token, handler } = setup({ scopes: ["read", "write"] });
    const call = async (id: number, name: string, args: unknown) => {
      const res = await handler(event({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, { token }));
      return JSON.parse(String(res.body)).result as { isError?: boolean; content: { text: string }[] };
    };
    const created = await call(10, "create_pages", {
      parent: { pageId: "p1" },
      pages: [{ title: "Meeting", content: "# Agenda\n\n- item one" }],
    });
    expect(created.isError).toBeFalsy();
    const newId = JSON.parse(created.content[0].text).pages[0].id as string;

    const appended = await call(11, "update_page", { pageId: newId, content: { mode: "append", markdown: "Decision: ship" } });
    expect(appended.isError).toBeFalsy();
    const ranged = await call(12, "update_page", {
      pageId: newId,
      content: { mode: "replace_range", markdown: "## Agenda v2", rangeStart: "Agenda", rangeEnd: "Agenda" },
    });
    expect(JSON.parse(ranged.content[0].text)).toMatchObject({ contentChanged: true, bodySource: "room" });

    const fetched = await call(13, "fetch", { id: newId });
    expect(fetched.content[0].text).toContain("bodySource: collab");
    expect(fetched.content[0].text).toMatch(/## Agenda v2[\s\S]*- item one[\s\S]*Decision: ship/);
    expect(fetched.content[0].text).toContain("path: Hello page");

    const readOnly = setup();
    const denied = await readOnly.handler(event({
      jsonrpc: "2.0", id: 14, method: "tools/call", params: { name: "trash_page", arguments: { pageId: "p1" } },
    }, { token: readOnly.token }));
    const deniedResult = JSON.parse(String(denied.body)).result;
    expect(deniedResult.isError).toBe(true);
    expect(deniedResult.content[0].text).toBe("token lacks write scope");
  });

  it("일일 쓰기 상한 초과는 툴 오류(리셋 시각 안내), 읽기 툴은 영향 없음", async () => {
    process.env.MCP_DAILY_WRITE_LIMIT = "1";
    try {
      const { token, handler } = setup({ scopes: ["read", "write"] });
      const call = async (id: number, name: string, args: unknown) =>
        JSON.parse(String((await handler(event({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, { token }))).body)).result;
      expect((await call(20, "update_page", { pageId: "p1", title: "One" })).isError).toBeFalsy();
      const second = await call(21, "update_page", { pageId: "p1", title: "Two" });
      expect(second.isError).toBe(true);
      expect(second.content[0].text).toMatch(/Daily write limit reached .*Resets at/);
      expect((await call(22, "fetch", { id: "p1" })).isError).toBeFalsy();
      // move_pages 는 옮기는 페이지 수만큼 차감 — 새 토큰(상한 1)으로 2개 이동은 거부
      const other = setup({ scopes: ["read", "write"], tokenId: "tok-2" });
      const moved = JSON.parse(String((await other.handler(event({
        jsonrpc: "2.0", id: 23, method: "tools/call",
        params: { name: "move_pages", arguments: { pageIds: ["p1", "p1x"], newParent: { workspaceId: "ws-a" } } },
      }, { token: other.token }))).body)).result;
      expect(moved.content[0].text).toMatch(/Daily write limit reached/);
    } finally {
      delete process.env.MCP_DAILY_WRITE_LIMIT;
    }
  });

  it("DB 왕복: query → create_database → update_database(컬럼 추가) → create_pages(행) → query(필터)", async () => {
    const { token, handler } = setup({ scopes: ["read", "write"] });
    const call = async (id: number, name: string, args: unknown) => {
      const res = await handler(event({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, { token }));
      const result = JSON.parse(String(res.body)).result as { isError?: boolean; content: { text: string }[] };
      expect(result.isError, result.content[0].text).toBeFalsy();
      return result.content[0].text;
    };
    const created = JSON.parse(await call(30, "create_database", {
      parent: { pageId: "p1" }, title: "Bugs", columns: [{ name: "Severity", type: "select", options: ["High", "Low"] }],
    }));
    const databaseId = created.databaseId as string;
    expect(await call(31, "query_database", { databaseId })).toContain("matched: 0");
    await call(32, "update_database", { databaseId, addColumns: [{ name: "Points", type: "number" }] });
    await call(33, "create_pages", {
      parent: { databaseId },
      pages: [
        { title: "Crash on save", properties: { Severity: "High", Points: 5 } },
        { title: "Typo", properties: { Severity: "Low", Points: 1 } },
        { title: "Slow load", properties: { Severity: "High", Points: 3 } },
      ],
    });
    const result = await call(34, "query_database", {
      databaseId, filter: [{ column: "Severity", operator: "equals", value: "High" }], sorts: [{ column: "Points", direction: "asc" }],
    });
    expect(result).toContain("matched: 2");
    expect(result).toMatch(/Slow load[\s\S]*Crash on save/);
    expect(result).toContain("| id | title | Severity | Points |");
  });

  it("분당 한도 초과 시 429", async () => {
    // 분 단위 윈도 키라 실행 중 분 경계를 넘으면 카운터가 리셋돼 플래키해진다 — Date 만 고정한다(타이머는 실제).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:10.000Z"));
    try {
      const { token, handler } = setup();
      let last = 200;
      for (let i = 0; i < 121; i += 1) last = Number((await handler(event(INIT, { token }))).statusCode);
      expect(last).toBe(429);
    } finally {
      vi.useRealTimers();
    }
  });
});
