// 관리자 토큰 관리(조회·강제 폐기·일괄 폐기)와 워크스페이스 MCP 정책(설정 권한·툴별 시행).
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateMcpToken, hashMcpToken, MCP_OAUTH_ACCESS_PREFIX } from "../../_shared/mcpToken";
import { listMcpTokens } from "../../v5-resolvers/handlers/mcpToken";
import { adminListMcpTokens, adminRevokeMcpToken, adminRevokeMcpTokensByMember } from "../../v5-resolvers/handlers/mcpTokenAdmin";
import { listMyWorkspaces } from "../../v5-resolvers/handlers/workspace";
import { setWorkspaceMcpPolicy } from "../../v5-resolvers/handlers/workspaceMcpPolicy";
import { createHandler } from "../index";
import { oauthConfigFromEnv } from "../oauth/config";
import { accessKey, familyKey } from "../oauth/store";
import { getCommentsTool } from "../tools/comments";
import { fetchTool } from "../tools/fetch";
import { listWorkspacesTool } from "../tools/listWorkspaces";
import { queryDatabaseTool } from "../tools/queryDatabase";
import { searchTool } from "../tools/search";
import { updatePageTool } from "../tools/updatePage";
import { createPagesTool } from "../tools/createPages";
import { READ_ONLY_POLICY_ERROR } from "../writeAccess";
import { resetCollabMocks } from "./collabMocks";
import { createFakeDdb, type Item } from "./fakeDdb";
import { baseTables, makeCtx, member, TABLES, tokenRecord } from "./fixtures";

vi.mock("../../realtime/yjsStore", async () => (await import("./collabMocks")).yjsStoreMock);
vi.mock("../wsBroadcast", async () => (await import("./collabMocks")).broadcastMock);
vi.mock("../publish", async () => (await import("./collabMocks")).publishMock);

beforeEach(() => resetCollabMocks());

const manager = member({ memberId: "admin", workspaceRole: "manager", name: "Admin", email: "admin@example.com", personalWorkspaceId: "ws-personal-admin" });

function tokenTables() {
  const tables = baseTables();
  const pat = generateMcpToken();
  const oat = generateMcpToken(MCP_OAUTH_ACCESS_PREFIX);
  tables.members.push(manager as unknown as Item);
  tables["mcp-tokens"] = [
    tokenRecord({ tokenHash: hashMcpToken(pat), tokenId: "pat-1", memberId: "m1", name: "Laptop", workspaceIds: ["ws-a"], createdAt: "2026-02-01T00:00:00.000Z" }),
    tokenRecord({ tokenHash: familyKey("fam-1"), tokenId: "fam-1", memberId: "m1", name: "Claude", kind: "oauth", clientId: "c1", createdAt: "2026-03-01T00:00:00.000Z" }) as unknown as Item,
    { tokenHash: accessKey(oat), tokenId: "oat-1", kind: "oauth_access", familyId: "fam-1", clientId: "c1", scopes: ["read"], expiresAt: "2999-01-01T00:00:00.000Z" },
    tokenRecord({ tokenHash: "h-m2", tokenId: "pat-2", memberId: "m2", name: "Bob token", revokedAt: "2026-04-01T00:00:00.000Z" }),
  ] as Item[];
  return { tables, pat, oat };
}

function mcpEvent(token: string): APIGatewayProxyEventV2 {
  return {
    rawPath: "/mcp", rawQueryString: "",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }), isBase64Encoded: false,
    requestContext: { http: { method: "POST", sourceIp: "1.1.1.1" }, domainName: "x.on.aws" },
  } as unknown as APIGatewayProxyEventV2;
}

describe("관리자 토큰 관리", () => {
  it("manager 미만은 admin API 전부 거부", async () => {
    const { tables } = tokenTables();
    const base = { doc: createFakeDdb(tables).doc, tables: TABLES, caller: member() };
    await expect(adminListMcpTokens(base)).rejects.toMatchObject({ errorType: "Forbidden" });
    await expect(adminRevokeMcpToken({ ...base, tokenId: "pat-1" })).rejects.toMatchObject({ errorType: "Forbidden" });
    await expect(adminRevokeMcpTokensByMember({ ...base, memberId: "m1" })).rejects.toMatchObject({ errorType: "Forbidden" });
  });

  it("조회: PAT·OAuth 연결만(oat 항목 제외), 해시 없음, 멤버·워크스페이스 이름·상태 포함, 필터", async () => {
    const { tables } = tokenTables();
    const base = { doc: createFakeDdb(tables).doc, tables: TABLES, caller: manager };
    const all = await adminListMcpTokens(base);
    expect(all.items.map((t) => t.tokenId).sort()).toEqual(["fam-1", "pat-1", "pat-2"]);
    expect(JSON.stringify(all)).not.toMatch(/tokenHash|oat#|oauth-family#/);
    const pat = all.items.find((t) => t.tokenId === "pat-1")!;
    expect(pat).toMatchObject({ kind: "pat", memberName: "Alice", memberEmail: "m1@example.com", status: "active", workspaces: [{ workspaceId: "ws-a", name: "Alpha" }] });
    expect(all.items.find((t) => t.tokenId === "fam-1")).toMatchObject({ kind: "oauth", clientName: "Claude" });
    expect((await adminListMcpTokens({ ...base, filter: { kind: "oauth" } })).items.map((t) => t.tokenId)).toEqual(["fam-1"]);
    expect((await adminListMcpTokens({ ...base, filter: { status: "revoked" } })).items.map((t) => t.tokenId)).toEqual(["pat-2"]);
    expect((await adminListMcpTokens({ ...base, filter: { memberId: "m2" } })).items.map((t) => t.tokenId)).toEqual(["pat-2"]);
  });

  it("강제 폐기 직후 그 PAT·OAuth family 로 MCP 호출은 401, 본인 목록에 관리자 폐기 표시", async () => {
    const { tables, pat, oat } = tokenTables();
    const fake = createFakeDdb(tables);
    const handler = createHandler({ doc: fake.doc, tables: TABLES, collabRoomEpoch: "v5", originVerify: "", oauth: { config: oauthConfigFromEnv() } });
    expect((await handler(mcpEvent(pat))).statusCode).toBe(200);
    expect((await handler(mcpEvent(oat))).statusCode).toBe(200);

    const base = { doc: fake.doc, tables: TABLES, caller: manager };
    const revoked = await adminRevokeMcpToken({ ...base, tokenId: "pat-1", reason: "기기 분실" });
    expect(revoked).toMatchObject({ status: "revoked", revokedBy: "admin", revokeReason: "기기 분실" });
    await adminRevokeMcpToken({ ...base, tokenId: "fam-1" });
    expect((await handler(mcpEvent(pat))).statusCode).toBe(401);
    expect((await handler(mcpEvent(oat))).statusCode).toBe(401);

    const mine = await listMcpTokens({ doc: fake.doc, tables: TABLES, caller: member() });
    expect(mine.find((t) => t.tokenId === "pat-1")).toMatchObject({ revokedByAdmin: true, revokeReason: "기기 분실" });
  });

  it("멤버별 일괄 폐기: 활성 PAT·OAuth 연결만, 이미 폐기된 것·access token 항목은 건드리지 않음", async () => {
    const { tables } = tokenTables();
    const fake = createFakeDdb(tables);
    const r = await adminRevokeMcpTokensByMember({ doc: fake.doc, tables: TABLES, caller: manager, memberId: "m1", reason: "퇴사" });
    expect(r.revokedCount).toBe(2);
    expect(r.items.map((t) => t.tokenId).sort()).toEqual(["fam-1", "pat-1"]);
    expect(fake.tables["mcp-tokens"].find((t) => t.tokenId === "oat-1")?.revokedAt).toBeUndefined();
    const again = await adminRevokeMcpTokensByMember({ doc: fake.doc, tables: TABLES, caller: manager, memberId: "m1" });
    expect(again.revokedCount).toBe(0);
  });
});

describe("워크스페이스 MCP 정책 — 설정 권한", () => {
  function setup() {
    const tables = baseTables();
    tables.workspaces.push({ workspaceId: "ws-personal-m1", name: "Mine", type: "personal", ownerMemberId: "m1", createdAt: "x" });
    return createFakeDdb(tables);
  }

  it("공유는 manager 이상, 개인은 소유자 본인, 스케줄러 WS 는 거부, 잘못된 값 거부", async () => {
    const fake = setup();
    const as = (caller: ReturnType<typeof member>) => ({ doc: fake.doc, tables: TABLES, caller });
    await expect(setWorkspaceMcpPolicy({ ...as(member()), workspaceId: "ws-a", policy: "read" })).rejects.toMatchObject({ errorType: "Forbidden" });
    const ws = await setWorkspaceMcpPolicy({ ...as(manager), workspaceId: "ws-a", policy: "read" });
    expect(ws.mcpPolicy).toBe("read");
    await expect(setWorkspaceMcpPolicy({ ...as(member()), workspaceId: "ws-personal-m1", policy: "disabled" })).resolves.toMatchObject({ mcpPolicy: "disabled" });
    await expect(setWorkspaceMcpPolicy({ ...as({ ...manager, workspaceRole: "owner" }), workspaceId: "ws-personal-m1", policy: "read" }))
      .rejects.toMatchObject({ errorType: "Forbidden" });
    await expect(setWorkspaceMcpPolicy({ ...as(manager), workspaceId: "ws-a", policy: "all" })).rejects.toMatchObject({ errorType: "BadRequest" });
    const mine = await listMyWorkspaces(as(member()));
    expect(mine.find((w) => w.workspaceId === "ws-b")?.mcpPolicy).toBe("readWrite"); // 미설정 = readWrite
  });
});

describe("워크스페이스 MCP 정책 — 툴별 시행", () => {
  function setup(policyA: string, policyB = "readWrite") {
    const tables = baseTables();
    tables.workspaces = tables.workspaces.map((w) =>
      w.workspaceId === "ws-a" ? { ...w, mcpPolicy: policyA } : w.workspaceId === "ws-b" ? { ...w, mcpPolicy: policyB } : w);
    tables["workspace-access"].push({ workspaceId: "ws-b", subjectKey: "member#m1x", subjectType: "member", subjectId: "m1", level: "edit" });
    tables.pages = [
      { id: "pa", workspaceId: "ws-a", title: "Secret plan", order: "0", updatedAt: "2026-01-02", doc: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "plan body" }] }] }) },
      { id: "pb", workspaceId: "ws-b", title: "Public plan", order: "0", updatedAt: "2026-01-01" },
    ];
    tables.databases = [{ id: "dba", workspaceId: "ws-a", title: "A db", columns: JSON.stringify([{ id: "t", name: "Name", type: "title" }]) }];
    tables.comments = [{ id: "k", workspaceId: "ws-a", pageId: "pa", blockId: "b", authorMemberId: "m1", bodyText: "hi", createdAt: "x" }];
    return makeCtx(tables, { scopes: ["read", "write"] });
  }

  it("disabled: 목록·검색에서 빠지고 fetch·query·get_comments 는 not found", async () => {
    const { ctx } = setup("disabled");
    expect((await listWorkspacesTool(ctx)).workspaces.map((w) => w.id)).not.toContain("ws-a");
    const found = await searchTool(ctx, { query: "plan" });
    expect(found.results.map((r) => r.id)).toEqual(["pb"]);
    await expect(fetchTool(ctx, { id: "pa" })).rejects.toThrow(/Not found or not accessible/);
    await expect(fetchTool(ctx, { id: "dba" })).rejects.toThrow(/Not found or not accessible/);
    await expect(queryDatabaseTool(ctx, { databaseId: "dba" })).rejects.toThrow(/Not found or not accessible/);
    await expect(getCommentsTool(ctx, { pageId: "pa" })).rejects.toThrow(/Not found or not accessible/);
    await expect(searchTool(ctx, { query: "plan", workspaceId: "ws-a" })).rejects.toThrow(/Not found or not accessible/);
  });

  it("read: 읽기는 되고 쓰기 툴은 정책 오류, readWrite 는 그대로", async () => {
    const { ctx } = setup("read");
    expect((await listWorkspacesTool(ctx)).workspaces.find((w) => w.id === "ws-a")).toMatchObject({ mcpPolicy: "read" });
    await expect(fetchTool(ctx, { id: "pa" })).resolves.toContain("plan body");
    await expect(updatePageTool(ctx, { pageId: "pa", title: "x" })).rejects.toThrow(READ_ONLY_POLICY_ERROR);
    await expect(createPagesTool(ctx, { parent: { workspaceId: "ws-a" }, pages: [{ title: "n" }] })).rejects.toThrow(READ_ONLY_POLICY_ERROR);
    const ok = setup("readWrite");
    await expect(updatePageTool(ok.ctx, { pageId: "pa", title: "Renamed" })).resolves.toMatchObject({ id: "pa" });
  });

  it("같은 요청 안에서는 워크스페이스 레코드를 한 번만 읽는다", async () => {
    const { ctx, fake } = setup("readWrite");
    await fetchTool(ctx, { id: "pa" });
    await getCommentsTool(ctx, { pageId: "pa" });
    await updatePageTool(ctx, { pageId: "pa", title: "Again" });
    const reads = fake.calls.filter((c) => c.constructor.name === "GetCommand" && c.input.TableName === TABLES.Workspaces && (c.input.Key as Item).workspaceId === "ws-a");
    expect(reads).toHaveLength(1);
  });
});
