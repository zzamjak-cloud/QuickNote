// OAuth 2.1 파사드 — 메타데이터·DCR·authorize·callback(동의)·token·refresh 회전·revoke 와 /mcp 인증까지 handler 전 구간.
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listMcpTokens, revokeMcpToken } from "../../v5-resolvers/handlers/mcpToken";
import { createHandler } from "../index";
import type { CognitoOps } from "../oauth/cognito";
import type { OAuthConfig } from "../oauth/config";
import { pkceS256, randomId } from "../oauth/crypto";
import { DCR_LIMIT_PER_HOUR, isAllowedRedirectUri } from "../oauth/register";
import { createFakeDdb, type Item } from "./fakeDdb";
import { baseTables, member, TABLES } from "./fixtures";

vi.mock("../../realtime/yjsStore", async () => (await import("./collabMocks")).yjsStoreMock);
vi.mock("../wsBroadcast", async () => (await import("./collabMocks")).broadcastMock);
vi.mock("../../template-automation/runner", async () => (await import("./collabMocks")).publishMock);

const ORIGIN = "https://mcp.example.com";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const CONFIG: OAuthConfig = {
  clientsTable: "oauth-clients",
  grantsTable: "oauth-grants",
  cognitoDomain: "https://auth.example.com",
  userPoolId: "pool",
  cognitoClientIdParam: "",
  cognitoClientId: "cog-client",
};

type EvOpts = { query?: Record<string, string>; body?: string; headers?: Record<string, string>; cookie?: string; ip?: string };

function ev(method: string, path: string, opts: EvOpts = {}): APIGatewayProxyEventV2 {
  return {
    rawPath: path,
    rawQueryString: opts.query ? new URLSearchParams(opts.query).toString() : "",
    headers: { ...(opts.headers ?? {}) },
    cookies: opts.cookie ? [opts.cookie] : undefined,
    body: opts.body,
    isBase64Encoded: false,
    requestContext: { http: { method, sourceIp: opts.ip ?? "1.2.3.4" }, domainName: "mcp.example.com" },
  } as unknown as APIGatewayProxyEventV2;
}

const form = (fields: Record<string, string | string[]>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) p.append(k, x);
  return p.toString();
};
const FORM_HEADERS = { "content-type": "application/x-www-form-urlencoded" };

function setup(opts: { memberStatus?: string; badNonce?: boolean } = {}) {
  const tables = baseTables();
  tables.members = [member({ status: (opts.memberStatus ?? "active") as "active" }) as unknown as Item];
  tables.pages = [{ id: "p1", workspaceId: "ws-a", title: "Hello page", updatedAt: "2026-09-01", doc: "" }];
  const fake = createFakeDdb(tables);
  // auth.ts 는 시계를 주입받지 않으므로 Date 자체를 고정한다.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-03T00:00:00.000Z"));
  let lastNonce = "";
  const cognito: CognitoOps = {
    clientId: async () => "cog-client",
    exchangeCode: vi.fn(async () => "id-token"),
    verifyIdToken: vi.fn(async () => ({ sub: "sub-1", nonce: opts.badNonce ? "other" : lastNonce })),
  };
  const handler = createHandler({
    doc: fake.doc,
    tables: TABLES,
    collabRoomEpoch: "v5",
    oauth: { config: CONFIG, cognito, now: () => new Date() },
  });
  const call = async (e: APIGatewayProxyEventV2) => {
    const r = await handler(e);
    if (r.statusCode === 302 && String(r.headers?.location).startsWith(CONFIG.cognitoDomain)) {
      lastNonce = new URL(String(r.headers?.location)).searchParams.get("nonce") ?? "";
    }
    return r;
  };
  return {
    tables,
    fake,
    cognito,
    call,
    advance: (ms: number) => vi.setSystemTime(new Date(Date.now() + ms)),
  };
}

type Env = ReturnType<typeof setup>;

afterEach(() => {
  vi.useRealTimers();
});

async function register(env: Env, body: unknown = { client_name: "Claude", redirect_uris: [REDIRECT] }) {
  return env.call(ev("POST", "/register", { body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
}

/** register → authorize → callback → (동의 화면) 까지. */
async function startFlow(env: Env, authorizeQuery: Record<string, string> = {}) {
  const reg = JSON.parse(String((await register(env)).body));
  const verifier = randomId(48);
  const authz = await env.call(
    ev("GET", "/authorize", {
      query: {
        response_type: "code",
        client_id: reg.client_id,
        redirect_uri: REDIRECT,
        code_challenge: pkceS256(verifier),
        code_challenge_method: "S256",
        state: "st-1",
        scope: "read write",
        resource: `${ORIGIN}/mcp`,
        ...authorizeQuery,
      },
    }),
  );
  const txId = new URL(String(authz.headers?.location)).searchParams.get("state") ?? "";
  const cookie = String(authz.cookies?.[0] ?? "").split(";")[0];
  const consent = await env.call(ev("GET", "/callback", { query: { code: "cog-code", state: txId }, cookie }));
  const csrf = /name="csrf" value="([^"]+)"/.exec(String(consent.body))?.[1] ?? "";
  return { clientId: reg.client_id as string, verifier, authz, txId, cookie, consent, csrf };
}

async function approve(env: Env, flow: Awaited<ReturnType<typeof startFlow>>, fields: Record<string, string | string[]> = {}) {
  return env.call(
    ev("POST", "/consent", {
      body: form({ tx: flow.txId, csrf: flow.csrf, action: "approve", scope: "write", expiryDays: "30", ...fields }),
      headers: FORM_HEADERS,
      cookie: flow.cookie,
    }),
  );
}

async function token(env: Env, fields: Record<string, string>) {
  return env.call(ev("POST", "/token", { body: form(fields), headers: FORM_HEADERS }));
}

/** 전체 흐름 → 토큰 응답. */
async function connect(env: Env, consentFields: Record<string, string | string[]> = {}) {
  const flow = await startFlow(env);
  const redirected = new URL(String((await approve(env, flow, consentFields)).headers?.location));
  const res = await token(env, {
    grant_type: "authorization_code",
    code: redirected.searchParams.get("code") ?? "",
    redirect_uri: REDIRECT,
    code_verifier: flow.verifier,
    client_id: flow.clientId,
  });
  return { flow, res, body: JSON.parse(String(res.body)) };
}

const INIT = {
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
};
function mcp(env: Env, accessToken: string, body: unknown = INIT) {
  return env.call(
    ev("POST", "/mcp", {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${accessToken}`,
      },
    }),
  );
}
async function toolText(env: Env, accessToken: string, name: string, args: Record<string, unknown>) {
  const res = await mcp(env, accessToken, { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } });
  return JSON.parse(String(res.body)).result as { isError?: boolean; content: { text: string }[] };
}

describe("메타데이터", () => {
  it("PRM(RFC 9728) 은 루트·/mcp 접미 경로 모두, AS 메타데이터(RFC 8414) 는 issuer=origin", async () => {
    const env = setup();
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const r = await env.call(ev("GET", path));
      expect(r.statusCode).toBe(200);
      expect(r.headers?.["access-control-allow-origin"]).toBe("*");
      expect(JSON.parse(String(r.body))).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN] });
    }
    const as = JSON.parse(String((await env.call(ev("GET", "/.well-known/oauth-authorization-server"))).body));
    expect(as).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/authorize`,
      token_endpoint: `${ORIGIN}/token`,
      registration_endpoint: `${ORIGIN}/register`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
    const pre = await env.call(ev("OPTIONS", "/token"));
    expect(pre.statusCode).toBe(204);
    expect(pre.headers?.["access-control-allow-origin"]).toBe("*");
    // 브라우저 HTML 경로에는 CORS 를 열지 않는다.
    expect((await env.call(ev("OPTIONS", "/authorize"))).headers?.["access-control-allow-origin"]).toBeUndefined();
  });

  it("/mcp 401 은 WWW-Authenticate 에 resource_metadata 를 싣는다", async () => {
    const env = setup();
    const r = await mcp(env, "qn_oat_bogus");
    expect(r.statusCode).toBe(401);
    expect(r.headers?.["www-authenticate"]).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
  });

  it("OAuth 미설정이면 OAuth 경로는 404, 401 헤더도 기존 형태", async () => {
    const fake = createFakeDdb(baseTables());
    const handler = createHandler({ doc: fake.doc, tables: TABLES, collabRoomEpoch: "v5", oauth: { config: { ...CONFIG, clientsTable: "" } } });
    expect((await handler(ev("GET", "/.well-known/oauth-authorization-server"))).statusCode).toBe(404);
  });
});

describe("DCR(RFC 7591)", () => {
  it.each([
    ["https://claude.ai/cb", true],
    ["http://127.0.0.1:3000/cb", true],
    ["http://localhost/cb", true],
    ["http://[::1]:8080/cb", true],
    ["http://evil.example.com/cb", false],
    ["https://claude.ai/cb#frag", false],
    ["https://user:pw@claude.ai/cb", false],
    ["javascript:alert(1)", false],
    ["custom-scheme://cb", false],
  ])("redirect_uri %s → %s", (uri, ok) => {
    expect(isAllowedRedirectUri(uri)).toBe(ok);
  });

  it("public 클라이언트만 등록하고 비밀을 발급하지 않는다", async () => {
    const env = setup();
    const ok = await register(env);
    expect(ok.statusCode).toBe(201);
    const body = JSON.parse(String(ok.body));
    expect(body.client_id).toMatch(/^qnc_/);
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(body.client_secret).toBeUndefined();
    expect(env.tables["oauth-clients"][0]).toMatchObject({ clientName: "Claude", redirectUris: [REDIRECT] });

    const secret = await register(env, { redirect_uris: [REDIRECT], token_endpoint_auth_method: "client_secret_basic" });
    expect(JSON.parse(String(secret.body)).error).toBe("invalid_client_metadata");
    const badUri = await register(env, { redirect_uris: ["http://evil.example.com/cb"] });
    expect(JSON.parse(String(badUri.body)).error).toBe("invalid_redirect_uri");
    expect((await register(env, { redirect_uris: [] })).statusCode).toBe(400);
    expect((await env.call(ev("POST", "/register", { body: "{not json" }))).statusCode).toBe(400);
  });

  it("IP 당 시간당 등록 상한", async () => {
    const env = setup();
    for (let i = 0; i < DCR_LIMIT_PER_HOUR; i += 1) expect((await register(env)).statusCode).toBe(201);
    expect((await register(env)).statusCode).toBe(429);
  });
});

describe("/authorize 검증", () => {
  async function authorize(env: Env, query: Record<string, string>) {
    const reg = JSON.parse(String((await register(env)).body));
    const base = {
      response_type: "code",
      client_id: reg.client_id,
      redirect_uri: REDIRECT,
      code_challenge: pkceS256(randomId(48)),
      code_challenge_method: "S256",
      state: "st-1",
    };
    return env.call(ev("GET", "/authorize", { query: { ...base, ...query } }));
  }
  const errorOf = (r: { headers?: Record<string, unknown> }) => new URL(String(r.headers?.location)).searchParams;

  it("미등록 client·redirect_uri 는 리다이렉트하지 않고 HTML 오류", async () => {
    const env = setup();
    const unknown = await authorize(env, { client_id: "qnc_nope" });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.headers?.location).toBeUndefined();
    const evil = await authorize(env, { redirect_uri: "https://evil.example.com/cb" });
    expect(evil.statusCode).toBe(400);
    expect(evil.headers?.location).toBeUndefined();
    expect(evil.headers?.["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  it.each([
    [{ code_challenge_method: "plain" }, "invalid_request"],
    [{ code_challenge: "" }, "invalid_request"],
    [{ response_type: "token" }, "unsupported_response_type"],
    [{ scope: "admin" }, "invalid_scope"],
    [{ resource: "https://other.example.com/mcp" }, "invalid_target"],
  ])("%o → %s (state 유지)", async (query, error) => {
    const env = setup();
    const r = await authorize(env, query as Record<string, string>);
    expect(r.statusCode).toBe(302);
    expect(errorOf(r).get("error")).toBe(error);
    expect(errorOf(r).get("state")).toBe("st-1");
    expect(String(r.headers?.location).startsWith(REDIRECT)).toBe(true);
  });

  it("정상 요청은 Cognito(Google)로 보내고 바인딩 쿠키를 심는다", async () => {
    const env = setup();
    const r = await authorize(env, { scope: "read", resource: `${ORIGIN}/mcp` });
    const loc = new URL(String(r.headers?.location));
    expect(loc.origin).toBe(CONFIG.cognitoDomain);
    expect(loc.searchParams.get("identity_provider")).toBe("Google");
    expect(loc.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/callback`);
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
    expect(String(r.cookies?.[0])).toMatch(/^__Host-qn_oauth_tx=[^;]+; Path=\/; Secure; HttpOnly; SameSite=Lax/);
    const tx = env.tables["oauth-grants"].find((i) => String(i.pk).startsWith("tx#"));
    expect(tx).toMatchObject({ stage: "login", scopes: ["read"], resource: `${ORIGIN}/mcp`, state: "st-1" });
  });
});

describe("/callback · /consent", () => {
  it("동의 화면: 엄격한 CSP·스크립트 없음·클라이언트 이름·redirect 호스트·워크스페이스", async () => {
    const env = setup();
    const { consent } = await startFlow(env);
    expect(consent.statusCode).toBe(200);
    const csp = String(consent.headers?.["content-security-policy"]);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self' https://claude.ai");
    expect(csp).not.toContain("unsafe-inline");
    const body = String(consent.body);
    expect(body).not.toMatch(/<script/i);
    expect(body).toContain("Claude");
    expect(body).toContain("claude.ai");
    expect(body).toContain('value="ws-a"');
    expect(body).not.toContain('value="ws-c"');
  });

  it("바인딩 쿠키 없음·불일치·nonce 불일치·비활성 멤버는 거부", async () => {
    const env = setup();
    const reg = JSON.parse(String((await register(env)).body));
    const authz = await env.call(
      ev("GET", "/authorize", {
        query: { response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: pkceS256(randomId(48)), code_challenge_method: "S256" },
      }),
    );
    const txId = new URL(String(authz.headers?.location)).searchParams.get("state") ?? "";
    const cookie = String(authz.cookies?.[0]).split(";")[0];
    const callback = (c?: string) => env.call(ev("GET", "/callback", { query: { code: "c", state: txId }, cookie: c }));
    expect((await callback()).statusCode).toBe(400);
    expect((await callback(`__Host-qn_oauth_tx=${randomId()}`)).statusCode).toBe(400);
    expect(env.cognito.exchangeCode).not.toHaveBeenCalled();
    expect((await callback(cookie)).statusCode).toBe(200);
    expect((await callback(cookie)).statusCode).toBe(400); // 같은 tx 재진입 불가

    expect((await startFlow(setup({ badNonce: true }))).consent.statusCode).toBe(400);
    expect((await startFlow(setup({ memberStatus: "removed" }))).consent.statusCode).toBe(403);
  });

  it("CSRF 토큰 불일치·재제출·허용 밖 워크스페이스는 거부, 거부 버튼은 access_denied", async () => {
    const env = setup();
    const flow = await startFlow(env);
    expect((await approve(env, { ...flow, csrf: randomId() })).statusCode).toBe(400);
    expect((await approve(env, flow, { workspaceIds: "ws-c" })).statusCode).toBe(400);
    expect(env.tables["oauth-grants"].some((i) => String(i.pk).startsWith("code#"))).toBe(false);

    const env2 = setup();
    const flow2 = await startFlow(env2);
    const ok = await approve(env2, flow2);
    expect(ok.statusCode).toBe(303);
    const loc = new URL(String(ok.headers?.location));
    expect(loc.searchParams.get("state")).toBe("st-1");
    expect(loc.searchParams.get("iss")).toBe(ORIGIN);
    expect(loc.searchParams.get("code")).toBeTruthy();
    expect((await approve(env2, flow2)).statusCode).toBe(400); // 재제출

    const env3 = setup();
    const flow3 = await startFlow(env3);
    const denied = new URL(String((await approve(env3, flow3, { action: "deny" })).headers?.location));
    expect(denied.searchParams.get("error")).toBe("access_denied");
    expect(denied.searchParams.get("code")).toBeNull();
  });
});

describe("/token", () => {
  it("PKCE·redirect_uri·client 불일치는 invalid_grant, 코드는 단일 사용", async () => {
    const env = setup();
    const flow = await startFlow(env);
    const code = new URL(String((await approve(env, flow)).headers?.location)).searchParams.get("code") ?? "";
    const base = { grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: flow.verifier, client_id: flow.clientId };

    const wrongVerifier = await token(env, { ...base, code_verifier: randomId(48) });
    expect(JSON.parse(String(wrongVerifier.body)).error).toBe("invalid_grant");
    // 실패한 시도로도 코드는 소모된다(재시도 불가).
    expect(JSON.parse(String((await token(env, base)).body)).error).toBe("invalid_grant");

    const env2 = setup();
    const flow2 = await startFlow(env2);
    const code2 = new URL(String((await approve(env2, flow2)).headers?.location)).searchParams.get("code") ?? "";
    const base2 = { ...base, code: code2, code_verifier: flow2.verifier, client_id: flow2.clientId };
    expect(JSON.parse(String((await token(env2, { ...base2, redirect_uri: "https://claude.ai/other" })).body)).error).toBe("invalid_grant");

    const env3 = setup();
    const flow3 = await startFlow(env3);
    const code3 = new URL(String((await approve(env3, flow3)).headers?.location)).searchParams.get("code") ?? "";
    const base3 = { ...base, code: code3, code_verifier: flow3.verifier, client_id: flow3.clientId };
    const first = await token(env3, base3);
    expect(first.statusCode).toBe(200);
    expect(first.headers?.["cache-control"]).toBe("no-store");
    expect(JSON.parse(String((await token(env3, base3)).body)).error).toBe("invalid_grant");
  });

  it("만료된 코드·미지원 grant·form 아닌 본문·미등록 client", async () => {
    const env = setup();
    const flow = await startFlow(env);
    const code = new URL(String((await approve(env, flow)).headers?.location)).searchParams.get("code") ?? "";
    env.advance(61_000);
    const expired = await token(env, { grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: flow.verifier, client_id: flow.clientId });
    expect(JSON.parse(String(expired.body)).error).toBe("invalid_grant");
    expect(JSON.parse(String((await token(env, { grant_type: "password", client_id: flow.clientId })).body)).error).toBe("unsupported_grant_type");
    const json = await env.call(ev("POST", "/token", { body: "{}", headers: { "content-type": "application/json" } }));
    expect(JSON.parse(String(json.body)).error).toBe("invalid_request");
    const unknown = await token(env, { grant_type: "authorization_code", client_id: "qnc_nope" });
    expect(unknown.statusCode).toBe(401);
    expect(JSON.parse(String(unknown.body)).error).toBe("invalid_client");
  });

  it("발급: access(qn_oat_) 는 mcp-tokens 에 해시로, grant family 는 byMember 에 노출", async () => {
    const env = setup();
    const { body } = await connect(env);
    expect(body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "read write" });
    expect(body.access_token).toMatch(/^qn_oat_/);
    expect(body.refresh_token).toMatch(/^qn_ort_/);
    const items = env.tables["mcp-tokens"];
    expect(JSON.stringify(items)).not.toContain(body.access_token);
    expect(JSON.stringify(env.tables["oauth-grants"])).not.toContain(body.refresh_token);
    const family = items.find((i) => i.kind === "oauth");
    expect(family).toMatchObject({ memberId: "m1", name: "Claude", scopes: ["read", "write"], workspaceIds: [] });
    expect(items.find((i) => i.kind === "oauth_access")?.memberId).toBeUndefined();
  });
});

describe("refresh 회전 · 재사용 감지", () => {
  it("회전된 refresh 는 새 쌍을 주고, 옛 refresh 재사용 시 family 전체 폐기", async () => {
    const env = setup();
    const { flow, body } = await connect(env);
    const refresh = (rt: string, extra: Record<string, string> = {}) =>
      token(env, { grant_type: "refresh_token", refresh_token: rt, client_id: flow.clientId, ...extra });

    const narrowed = JSON.parse(String((await refresh(body.refresh_token, { scope: "read" })).body));
    expect(narrowed.scope).toBe("read");
    expect(narrowed.refresh_token).not.toBe(body.refresh_token);
    // 축소된 access token 은 write 툴을 못 쓴다.
    expect((await toolText(env, narrowed.access_token, "trash_page", { pageId: "p1" })).content[0].text).toMatch(/write scope/);

    // 옛 refresh 재사용 → invalid_grant + family 폐기 → 새 access·refresh 도 거부
    expect(JSON.parse(String((await refresh(body.refresh_token)).body)).error).toBe("invalid_grant");
    expect((await mcp(env, narrowed.access_token)).statusCode).toBe(401);
    expect(JSON.parse(String((await refresh(narrowed.refresh_token)).body)).error).toBe("invalid_grant");
  });

  it("다른 client 의 refresh·scope 확대는 거부", async () => {
    const env = setup();
    const { body } = await connect(env, { scope: "read" });
    const other = JSON.parse(String((await register(env)).body)).client_id;
    const r1 = await token(env, { grant_type: "refresh_token", refresh_token: body.refresh_token, client_id: other });
    expect(JSON.parse(String(r1.body)).error).toBe("invalid_grant");
    const flowClient = env.tables["oauth-clients"][0].clientId as string;
    const r2 = await token(env, { grant_type: "refresh_token", refresh_token: body.refresh_token, client_id: flowClient, scope: "read write" });
    expect(JSON.parse(String(r2.body)).error).toBe("invalid_scope");
  });
});

describe("/mcp 인증(qn_oat_) — PAT 와 같은 인가", () => {
  it("워크스페이스 범위·scope 가 PAT 경로와 같게 적용된다", async () => {
    const env = setup();
    const { body } = await connect(env, { scope: "read", workspaceIds: "ws-b" });
    expect((await mcp(env, body.access_token)).statusCode).toBe(200);
    const ws = JSON.parse((await toolText(env, body.access_token, "list_workspaces", {})).content[0].text);
    expect(ws.workspaces.map((w: { id: string }) => w.id)).toEqual(["ws-b"]);
    const fetched = await toolText(env, body.access_token, "fetch", { id: "p1" });
    expect(fetched.isError).toBe(true);
    expect(fetched.content[0].text).toMatch(/Not found or not accessible/);
    expect((await toolText(env, body.access_token, "trash_page", { pageId: "p1" })).content[0].text).toMatch(/write scope/);
  });

  it("access token 1시간 만료, 비활성 멤버 거부, 분당 상한은 family 단위", async () => {
    const env = setup();
    const { body } = await connect(env);
    expect((await mcp(env, body.access_token)).statusCode).toBe(200);
    const familyId = env.tables["mcp-tokens"].find((i) => i.kind === "oauth")?.tokenId;
    const rl = env.fake.calls.filter((c) => c.constructor.name === "UpdateCommand" && String((c.input.Key as Item)?.pk).startsWith("mcp-rl#"));
    expect((rl.at(-1)?.input.Key as Item).pk).toBe(`mcp-rl#${familyId}`);

    env.tables.members[0].status = "removed";
    expect((await mcp(env, body.access_token)).statusCode).toBe(401);
    env.tables.members[0].status = "active";
    env.advance(3600_000);
    expect((await mcp(env, body.access_token)).statusCode).toBe(401);
  });
});

describe("폐기", () => {
  it("/revoke(RFC 7009) 는 family 를 폐기한다", async () => {
    const env = setup();
    const { flow, body } = await connect(env);
    const r = await env.call(ev("POST", "/revoke", { body: form({ token: body.refresh_token, client_id: flow.clientId }), headers: FORM_HEADERS }));
    expect(r.statusCode).toBe(200);
    expect((await mcp(env, body.access_token)).statusCode).toBe(401);
    // 알 수 없는 토큰도 200
    const unknown = await env.call(ev("POST", "/revoke", { body: form({ token: "garbage", client_id: flow.clientId }), headers: FORM_HEADERS }));
    expect(unknown.statusCode).toBe(200);
  });

  it("설정 탭(listMcpTokens·revokeMcpToken)은 연결 앱을 kind=oauth 로 보여 주고 family 째 해제한다", async () => {
    const env = setup();
    const { flow, body } = await connect(env);
    const caller = member();
    const list = await listMcpTokens({ doc: env.fake.doc, tables: TABLES, caller });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "oauth", name: "Claude", scopes: ["read", "write"] });
    expect(list[0]).not.toHaveProperty("clientId");

    await revokeMcpToken({ doc: env.fake.doc, tables: TABLES, caller, tokenId: list[0].tokenId });
    expect((await mcp(env, body.access_token)).statusCode).toBe(401);
    const r = await token(env, { grant_type: "refresh_token", refresh_token: body.refresh_token, client_id: flow.clientId });
    expect(JSON.parse(String(r.body)).error).toBe("invalid_grant");
  });
});
