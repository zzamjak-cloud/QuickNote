// /authorize → Cognito(Google) 로그인 → /callback(동의 화면) → /consent(인가 코드 발급).
// 트랜잭션은 grants 테이블 tx#<id>(TTL 10분)에 두고, 브라우저 바인딩 쿠키(원문은 쿠키, 해시는 tx)로
// 다른 브라우저가 흐름을 이어받지 못하게 한다(로그인 CSRF·세션 고정 방지).
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { MCP_TOKEN_SCOPES, type McpTokenScope } from "../../_shared/mcpToken";
import { LC_SCHEDULER_WORKSPACE_ID, type Member } from "../../v5-resolvers/handlers/_auth";
import { listMyWorkspaces } from "../../v5-resolvers/handlers/workspace";
import { cognitoAuthorizeUrl } from "./cognito";
import { originOf, resourceUrl } from "./config";
import { consentPage, errorPage } from "./consentPage";
import { isPkceChallenge, isRandomIdFormat, pkceS256, randomId, safeEqual, sha256Hex } from "./crypto";
import type { OAuthDeps } from "./deps";
import { clientIp, getCookie, parseForm, redirect, single, withParams, type Result } from "./http";
import {
  consumeIpQuota,
  epochSeconds,
  getClient,
  getGrantItem,
  grantKey,
  putGrantItem,
  touchClient,
  transitionGrantItem,
  type CodeItem,
  type TxItem,
} from "./store";

export const TX_TTL_MS = 10 * 60 * 1000;
export const CODE_TTL_MS = 60 * 1000;
export const GRANT_DAYS = [30, 90] as const;
export const BINDING_COOKIE = "__Host-qn_oauth_tx";
const AUTHORIZE_LIMIT_PER_MIN = 30;
const MAX_STATE_LENGTH = 1024;

function bindingCookie(value: string, maxAgeSec: number): string {
  return `${BINDING_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
}
const CLEAR_BINDING = bindingCookie("", 0);

/** scope 파라미터 → 정규화된 scope 목록(write 는 read 포함). 미지정 = read. 알 수 없는 값이면 null. */
export function parseScope(raw: string | undefined): McpTokenScope[] | null {
  const parts = (raw ?? "").split(" ").filter(Boolean);
  if (parts.length === 0) return ["read"];
  if (!parts.every((p) => (MCP_TOKEN_SCOPES as readonly string[]).includes(p))) return null;
  return parts.includes("write") ? ["read", "write"] : ["read"];
}

/** RFC 8707 resource — 이 MCP 서버를 가리켜야 한다(끝 슬래시 허용). */
export function isOwnResource(resource: string, origin: string): boolean {
  const expected = resourceUrl(origin);
  return resource === expected || resource === `${expected}/`;
}

export async function handleAuthorize(event: APIGatewayProxyEventV2, deps: OAuthDeps): Promise<Result> {
  const now = deps.now();
  const q = new URLSearchParams(event.rawQueryString ?? "");
  const origin = originOf(event, deps.config);

  const clientId = single(q, "client_id");
  const client = clientId ? await getClient(deps.doc, deps.config.clientsTable, clientId) : null;
  if (!client) return errorPage(400, "등록되지 않은 클라이언트입니다.");

  // redirect_uri 를 검증하기 전에는 절대 리다이렉트하지 않는다(오픈 리다이렉트 방지).
  const requestedRedirect = single(q, "redirect_uri");
  if (requestedRedirect === null) return errorPage(400, "redirect_uri 가 중복되었습니다.");
  const redirectUri = requestedRedirect ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    return errorPage(400, "등록되지 않은 redirect_uri 입니다.");
  }

  // 사용자 인증 전 파라미터 오류는 redirect_uri 로 돌려보내지 않는다(RFC 9700 §4.11.2 — 사전 인증 오픈 리다이렉트 방지).
  const state = single(q, "state");
  const fail = (_error: string, description: string) => errorPage(400, `잘못된 연결 요청입니다 (${description}).`);
  if (state === null || (state && state.length > MAX_STATE_LENGTH)) return fail("invalid_request", "invalid state");
  if (single(q, "response_type") !== "code") return fail("unsupported_response_type", "response_type must be code");

  const challenge = single(q, "code_challenge");
  if (single(q, "code_challenge_method") !== "S256" || !isPkceChallenge(challenge)) {
    return fail("invalid_request", "PKCE S256 code_challenge required");
  }
  const scopeRaw = single(q, "scope");
  const scopes = scopeRaw === null ? null : parseScope(scopeRaw);
  if (!scopes) return fail("invalid_scope", "supported scopes: read, write");
  const resource = single(q, "resource");
  if (resource === null || (resource && !isOwnResource(resource, origin))) {
    return fail("invalid_target", "resource must be this MCP server");
  }

  const allowed = await consumeIpQuota({
    doc: deps.doc,
    table: deps.tables.RateLimit,
    key: `authz#${clientIp(event, deps)}`,
    windowSec: 60,
    limit: AUTHORIZE_LIMIT_PER_MIN,
    nowMs: now.getTime(),
  });
  if (!allowed) return errorPage(429, "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");

  const txId = randomId();
  const binding = randomId();
  const cognitoVerifier = randomId(48);
  const nonce = randomId();
  const expiresAt = new Date(now.getTime() + TX_TTL_MS).toISOString();
  const tx: TxItem = {
    pk: grantKey("tx", txId),
    stage: "login",
    clientId: client.clientId,
    clientName: client.clientName,
    redirectUri,
    codeChallenge: challenge,
    ...(state ? { state } : {}),
    scopes,
    resource: resourceUrl(origin),
    cognitoVerifier,
    nonce,
    bindingHash: sha256Hex(binding),
    expiresAt,
    ttl: epochSeconds(expiresAt),
  };
  await putGrantItem(deps.doc, deps.config.grantsTable, tx);
  await touchClient(deps.doc, deps.config.clientsTable, client, now);

  const location = cognitoAuthorizeUrl(deps.config, {
    clientId: await deps.cognito.clientId(),
    redirectUri: `${origin}/callback`,
    state: txId,
    challenge: pkceS256(cognitoVerifier),
    nonce,
  });
  return redirect(location, { cookies: [bindingCookie(binding, TX_TTL_MS / 1000)] });
}

/** 트랜잭션 로드 + 단계·만료·브라우저 바인딩 검사. */
async function loadBoundTx(
  event: APIGatewayProxyEventV2,
  deps: OAuthDeps,
  txId: string | null | undefined,
  stage: TxItem["stage"],
): Promise<TxItem | null> {
  if (!isRandomIdFormat(txId)) return null;
  const tx = await getGrantItem<TxItem>(deps.doc, deps.config.grantsTable, grantKey("tx", txId));
  if (!tx || tx.stage !== stage || tx.expiresAt <= deps.now().toISOString()) return null;
  const binding = getCookie(event, BINDING_COOKIE);
  if (!binding || !safeEqual(sha256Hex(binding), tx.bindingHash)) return null;
  return tx;
}

async function findMemberBySub(deps: OAuthDeps, sub: string): Promise<Member | null> {
  const r = await deps.doc.send(
    new QueryCommand({
      TableName: deps.tables.Members,
      IndexName: "byCognitoSub",
      KeyConditionExpression: "cognitoSub = :s",
      ExpressionAttributeValues: { ":s": sub },
      Limit: 1,
    }),
  );
  return (r.Items?.[0] as Member | undefined) ?? null;
}

/** 동의 화면 워크스페이스 — MCP access.ts 와 같은 기준(스케줄러 가상 WS·삭제 WS·타인 개인 WS 제외). */
async function consentWorkspaces(deps: OAuthDeps, caller: Member): Promise<{ id: string; name: string }[]> {
  const all = await listMyWorkspaces({ doc: deps.doc, tables: deps.tables, caller });
  return all
    .filter((w) => !w.removedAt && w.workspaceId !== LC_SCHEDULER_WORKSPACE_ID)
    .filter((w) => w.type !== "personal" || w.workspaceId === caller.personalWorkspaceId)
    .map((w) => ({ id: w.workspaceId, name: w.name }));
}

const EXPIRED_MESSAGE = "연결 요청이 만료되었거나 다른 브라우저에서 시작되었습니다.";

export async function handleCallback(event: APIGatewayProxyEventV2, deps: OAuthDeps): Promise<Result> {
  const q = new URLSearchParams(event.rawQueryString ?? "");
  const txId = single(q, "state");
  const tx = await loadBoundTx(event, deps, txId, "login");
  if (!tx || !txId) return errorPage(400, EXPIRED_MESSAGE, [CLEAR_BINDING]);

  // 로그인 취소·실패도 사용자 인증 전이므로 클라이언트로 리다이렉트하지 않는다(RFC 9700 §4.11.2).
  const closeTx = () =>
    transitionGrantItem({ doc: deps.doc, table: deps.config.grantsTable, pk: tx.pk, attr: "stage", from: "login", to: "done" });
  const code = single(q, "code");
  if (single(q, "error") || !code) {
    await closeTx();
    return errorPage(400, "로그인이 취소되었습니다.", [CLEAR_BINDING]);
  }

  let sub: string;
  try {
    const clientId = await deps.cognito.clientId();
    const origin = originOf(event, deps.config);
    const idToken = await deps.cognito.exchangeCode({ code, redirectUri: `${origin}/callback`, verifier: tx.cognitoVerifier, clientId });
    const claims = await deps.cognito.verifyIdToken(idToken, clientId);
    if (!claims.nonce || !safeEqual(claims.nonce, tx.nonce)) throw new Error("nonce 불일치");
    sub = claims.sub;
  } catch (err) {
    console.error("oauth Cognito 로그인 검증 실패", (err as Error).message);
    return errorPage(400, "로그인을 확인하지 못했습니다.", [CLEAR_BINDING]);
  }

  const member = await findMemberBySub(deps, sub);
  if (!member || member.status !== "active") {
    await closeTx();
    return errorPage(403, "QuickNote 활성 멤버만 연결할 수 있습니다.", [CLEAR_BINDING]);
  }

  const workspaces = await consentWorkspaces(deps, member);
  const csrf = randomId();
  const promoted = await transitionGrantItem<TxItem>({
    doc: deps.doc,
    table: deps.config.grantsTable,
    pk: tx.pk,
    attr: "stage",
    from: "login",
    to: "consent",
    set: {
      memberId: member.memberId,
      memberEmail: member.email,
      csrfHash: sha256Hex(csrf),
      allowedWorkspaceIds: workspaces.map((w) => w.id),
    },
  });
  if (!promoted) return errorPage(400, EXPIRED_MESSAGE, [CLEAR_BINDING]);

  return consentPage({
    txId,
    csrf,
    clientName: tx.clientName,
    redirectUri: tx.redirectUri,
    memberEmail: member.email,
    requestedScopes: tx.scopes,
    workspaces,
  });
}

export async function handleConsent(event: APIGatewayProxyEventV2, deps: OAuthDeps): Promise<Result> {
  const form = parseForm(event);
  const tx = await loadBoundTx(event, deps, single(form, "tx"), "consent");
  const csrf = single(form, "csrf");
  if (!tx || !csrf || !tx.csrfHash || !safeEqual(sha256Hex(csrf), tx.csrfHash)) {
    return errorPage(400, EXPIRED_MESSAGE, [CLEAR_BINDING]);
  }
  // 동의는 한 번만 — 동시 제출·재제출은 여기서 걸러진다.
  const done = await transitionGrantItem<TxItem>({
    doc: deps.doc,
    table: deps.config.grantsTable,
    pk: tx.pk,
    attr: "stage",
    from: "consent",
    to: "done",
  });
  if (!done || !tx.memberId) return errorPage(400, EXPIRED_MESSAGE, [CLEAR_BINDING]);

  const back = (params: Record<string, string | undefined>) =>
    redirect(withParams(tx.redirectUri, { ...params, state: tx.state }), { status: 303, cookies: [CLEAR_BINDING] });
  if (single(form, "action") !== "approve") return back({ error: "access_denied", error_description: "user denied" });

  const scopes: McpTokenScope[] = single(form, "scope") === "write" && tx.scopes.includes("write") ? ["read", "write"] : ["read"];
  const workspaceIds = Array.from(new Set(form.getAll("workspaceIds")));
  const allowedWs = new Set(tx.allowedWorkspaceIds ?? []);
  if (!workspaceIds.every((id) => allowedWs.has(id))) return errorPage(400, "선택할 수 없는 워크스페이스입니다.", [CLEAR_BINDING]);
  const days = Number(single(form, "expiryDays"));
  const grantDays = (GRANT_DAYS as readonly number[]).includes(days) ? days : GRANT_DAYS[0];

  const now = deps.now();
  const code = randomId();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();
  const item: CodeItem = {
    pk: grantKey("code", code),
    status: "active",
    clientId: tx.clientId,
    redirectUri: tx.redirectUri,
    codeChallenge: tx.codeChallenge,
    memberId: tx.memberId,
    scopes,
    workspaceIds,
    resource: tx.resource,
    grantDays,
    expiresAt,
    // 소비된 코드도 만료까지 남겨 재사용을 거부한다(TTL 은 여유를 둔다).
    ttl: epochSeconds(expiresAt, 10 * 60 * 1000),
  };
  await putGrantItem(deps.doc, deps.config.grantsTable, item);
  return back({ code, iss: originOf(event, deps.config) });
}
