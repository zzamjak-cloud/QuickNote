import { describe, expect, it } from "vitest";
import { hashMcpToken, isMcpTokenFormat } from "../../_shared/mcpToken";
import { baseTables, member, TABLES } from "../../mcp-server/__tests__/fixtures";
import { createFakeDdb, type Item } from "../../mcp-server/__tests__/fakeDdb";
import { createMcpToken, listMcpTokens, MAX_ACTIVE_MCP_TOKENS, revokeMcpToken } from "./mcpToken";

function setup(tables: Record<string, Item[]> = baseTables()) {
  const fake = createFakeDdb(tables);
  const base = { doc: fake.doc, tables: { ...TABLES }, caller: member() };
  return { fake, base, tables };
}

describe("createMcpToken", () => {
  it("원문은 응답에만 싣고 테이블에는 해시만 저장한다", async () => {
    const { base, tables } = setup();
    const res = await createMcpToken({ ...base, input: { name: "Claude", scopes: ["read"], workspaceIds: ["ws-a"], expiresInDays: 30 } });
    expect(isMcpTokenFormat(res.token)).toBe(true);
    const stored = tables["mcp-tokens"];
    expect(stored).toHaveLength(1);
    expect(stored[0].tokenHash).toBe(hashMcpToken(res.token));
    expect(JSON.stringify(stored[0])).not.toContain(res.token);
    expect(stored[0].memberId).toBe("m1");
    expect(res).not.toHaveProperty("tokenHash");
    expect(res.tokenHint).toBe(res.token.slice(-4));
    expect(res.expiresAt).toBeTruthy();
  });

  it.each([
    [{ name: "", scopes: ["read"] }],
    [{ name: "x".repeat(65), scopes: ["read"] }],
    [{ name: "a", scopes: ["write"] }],
    [{ name: "a", scopes: ["admin"] }],
    [{ name: "a", scopes: ["read"], expiresInDays: 0 }],
    [{ name: "a", scopes: ["read"], expiresInDays: 366 }],
  ])("잘못된 입력 거부 %#", async (input) => {
    const { base } = setup();
    await expect(createMcpToken({ ...base, input })).rejects.toMatchObject({ errorType: "BadRequest" });
  });

  it("접근 불가 워크스페이스로 범위를 지정하면 거부한다", async () => {
    const { base } = setup();
    await expect(
      createMcpToken({ ...base, input: { name: "a", scopes: ["read"], workspaceIds: ["ws-c"] } }),
    ).rejects.toMatchObject({ errorType: "BadRequest" });
  });

  it("활성 토큰 20개 초과 발급을 막고, 폐기 토큰은 세지 않는다", async () => {
    const tables = baseTables();
    tables["mcp-tokens"] = Array.from({ length: MAX_ACTIVE_MCP_TOKENS }, (_, i) => ({
      tokenHash: `h${i}`, tokenId: `t${i}`, memberId: "m1", createdAt: `2026-01-0${i % 9}`,
      revokedAt: i === 0 ? "2026-01-02T00:00:00.000Z" : null,
    }));
    const { base } = setup(tables);
    await expect(createMcpToken({ ...base, input: { name: "a", scopes: ["read"] } })).resolves.toBeTruthy();
    await expect(createMcpToken({ ...base, input: { name: "b", scopes: ["read"] } })).rejects.toMatchObject({
      errorType: "BadRequest",
    });
  });
});

describe("listMcpTokens / revokeMcpToken", () => {
  it("목록은 메타만 반환하고 본인 토큰만 폐기한다", async () => {
    const { base, tables } = setup();
    const created = await createMcpToken({ ...base, input: { name: "a", scopes: ["read", "write"] } });
    tables["mcp-tokens"].push({ tokenHash: "other", tokenId: "other-id", memberId: "m2", createdAt: "x" });

    const list = await listMcpTokens(base);
    expect(list.map((t) => t.tokenId)).toEqual([created.tokenId]);
    expect(list[0]).not.toHaveProperty("tokenHash");
    expect(list[0].scopes).toEqual(["read", "write"]);

    const revoked = await revokeMcpToken({ ...base, tokenId: created.tokenId });
    expect(revoked.revokedAt).toBeTruthy();
    expect(tables["mcp-tokens"][0].revokedAt).toBeTruthy();
    await expect(revokeMcpToken({ ...base, tokenId: "other-id" })).rejects.toMatchObject({ errorType: "NotFound" });
  });
});
