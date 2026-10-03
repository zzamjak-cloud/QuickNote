import { describe, expect, it } from "vitest";
import { generateMcpToken, hashMcpToken } from "../../_shared/mcpToken";
import { authenticate, LAST_USED_WRITE_INTERVAL_MS } from "../auth";
import { checkTokenRateLimit } from "../rateLimit";
import { createFakeDdb } from "./fakeDdb";
import { baseTables, member, TABLES, tokenRecord } from "./fixtures";

const NOW = new Date("2026-10-03T00:00:00.000Z");

function setup(tokenOverrides = {}, memberOverrides = {}) {
  const token = generateMcpToken();
  const tables = baseTables();
  tables.members = [member(memberOverrides) as unknown as Record<string, unknown>];
  tables["mcp-tokens"] = [tokenRecord({ tokenHash: hashMcpToken(token), ...tokenOverrides })];
  const fake = createFakeDdb(tables);
  const run = (authorization: string | undefined) =>
    authenticate({ doc: fake.doc, tables: TABLES, authorization, now: NOW });
  return { token, tables, fake, run };
}

describe("authenticate", () => {
  it("유효한 토큰이면 토큰·멤버를 돌려주고 lastUsedAt 을 기록한다", async () => {
    const { token, tables, run } = setup();
    const r = await run(`Bearer ${token}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.caller.memberId).toBe("m1");
    expect(tables["mcp-tokens"][0].lastUsedAt).toBe(NOW.toISOString());
  });

  it("lastUsedAt 이 5분 이내면 다시 쓰지 않는다", async () => {
    const recent = new Date(NOW.getTime() - LAST_USED_WRITE_INTERVAL_MS + 1000).toISOString();
    const { token, fake, run } = setup({ lastUsedAt: recent });
    await run(`Bearer ${token}`);
    expect(fake.calls.some((c) => c.constructor.name === "UpdateCommand")).toBe(false);
  });

  it.each([
    ["헤더 없음", undefined, "missing bearer token"],
    ["Bearer 아님", "Basic abc", "missing bearer token"],
    ["형식 불일치", "Bearer qn_pat_short", "invalid token"],
    ["미등록 토큰", `Bearer ${generateMcpToken()}`, "invalid token"],
  ])("%s → 거부", async (_label, header, reason) => {
    const { run } = setup();
    expect(await run(header)).toEqual({ ok: false, reason });
  });

  it("폐기·만료 토큰 거부", async () => {
    const revoked = setup({ revokedAt: "2026-10-01T00:00:00.000Z" });
    expect(await revoked.run(`Bearer ${revoked.token}`)).toEqual({ ok: false, reason: "token revoked" });
    const expired = setup({ expiresAt: "2026-10-02T00:00:00.000Z" });
    expect(await expired.run(`Bearer ${expired.token}`)).toEqual({ ok: false, reason: "token expired" });
  });

  it("비활성(removed) 멤버의 토큰 거부", async () => {
    const { token, run } = setup({}, { status: "removed" });
    expect(await run(`Bearer ${token}`)).toEqual({ ok: false, reason: "member inactive" });
  });
});

describe("checkTokenRateLimit", () => {
  it("분당 한도를 넘으면 남은 초를 돌려준다", async () => {
    const fake = createFakeDdb({});
    const call = () => checkTokenRateLimit({ doc: fake.doc, tableName: "rl", tokenId: "t", limit: 2, nowMs: 30_000 });
    expect(await call()).toBeNull();
    expect(await call()).toBeNull();
    expect(await call()).toBe(30);
  });
});
