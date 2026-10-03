// origin-verify 비밀 — Secrets Manager 조회·캐시(TTL 5분)·fail-closed, 핸들러 연동.
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHandler, ORIGIN_VERIFY_HEADER } from "../index";
import { oauthConfigFromEnv } from "../oauth/config";
import { ORIGIN_VERIFY_CACHE_TTL_MS, resetOriginVerifyCache, resolveOriginVerify } from "../originVerify";
import { createFakeDdb } from "./fakeDdb";
import { baseTables, TABLES } from "./fixtures";

const secretSend = vi.fn();
vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: class { send = secretSend; },
  GetSecretValueCommand: class { constructor(public input: unknown) {} },
}));

function event(headers: Record<string, string> = {}): APIGatewayProxyEventV2 {
  return {
    rawPath: "/mcp", rawQueryString: "", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }), isBase64Encoded: false,
    requestContext: { http: { method: "POST", sourceIp: "10.0.0.1" }, domainName: "abc.lambda-url.on.aws" },
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  resetOriginVerifyCache();
  secretSend.mockReset();
});
afterEach(() => {
  delete process.env.ORIGIN_VERIFY_SECRET_ID;
});

describe("resolveOriginVerify", () => {
  it("비밀 미설정이면 검사하지 않는다(로컬·테스트)", async () => {
    expect(await resolveOriginVerify(async () => "x")).toEqual({ kind: "disabled" });
  });

  it("한 번 읽어 5분 캐시하고, 만료되면 다시 읽는다(교체 반영)", async () => {
    process.env.ORIGIN_VERIFY_SECRET_ID = "dev-quicknote/mcp-origin-verify";
    const read = vi.fn().mockResolvedValueOnce("old").mockResolvedValueOnce("new");
    expect(await resolveOriginVerify(read, 0)).toEqual({ kind: "ready", value: "old" });
    expect(await resolveOriginVerify(read, ORIGIN_VERIFY_CACHE_TTL_MS - 1)).toEqual({ kind: "ready", value: "old" });
    expect(await resolveOriginVerify(read, ORIGIN_VERIFY_CACHE_TTL_MS)).toEqual({ kind: "ready", value: "new" });
    expect(read).toHaveBeenCalledWith("dev-quicknote/mcp-origin-verify");
  });

  it("조회 실패·빈 값은 unavailable(만료된 옛 값으로 허용하지 않음)", async () => {
    process.env.ORIGIN_VERIFY_SECRET_ID = "s";
    expect(await resolveOriginVerify(async () => "v", 0)).toEqual({ kind: "ready", value: "v" });
    expect(await resolveOriginVerify(async () => { throw new Error("AccessDenied"); }, ORIGIN_VERIFY_CACHE_TTL_MS + 1)).toEqual({ kind: "unavailable" });
    expect(await resolveOriginVerify(async () => "", ORIGIN_VERIFY_CACHE_TTL_MS * 3)).toEqual({ kind: "unavailable" });
  });
});

describe("핸들러 연동(Secrets Manager)", () => {
  const handler = () => createHandler({ doc: createFakeDdb(baseTables()).doc, tables: TABLES, collabRoomEpoch: "v5", oauth: { config: oauthConfigFromEnv() } });

  it("비밀을 못 읽으면 fail-closed 503", async () => {
    process.env.ORIGIN_VERIFY_SECRET_ID = "s";
    secretSend.mockRejectedValue(Object.assign(new Error("x"), { name: "AccessDeniedException" }));
    expect((await handler()(event({ [ORIGIN_VERIFY_HEADER]: "anything" }))).statusCode).toBe(503);
  });

  it("비밀과 일치하면 처리, 다르면 403(env 에 평문 없음)", async () => {
    process.env.ORIGIN_VERIFY_SECRET_ID = "s";
    secretSend.mockResolvedValue({ SecretString: "R4nd0mSecretValue" });
    expect(process.env.ORIGIN_VERIFY).toBeUndefined();
    expect((await handler()(event({ [ORIGIN_VERIFY_HEADER]: "nope" }))).statusCode).toBe(403);
    expect((await handler()(event({ [ORIGIN_VERIFY_HEADER]: "R4nd0mSecretValue" }))).statusCode).toBe(401);
    expect(secretSend).toHaveBeenCalledTimes(1); // 캐시
  });
});
