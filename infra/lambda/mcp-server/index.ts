// QuickNote 원격 MCP 서버(Lambda Function URL, BUFFERED).
// Streamable HTTP stateless 모드: 요청마다 서버·트랜스포트를 새로 만들고 SSE 없이 JSON 으로 응답한다.
// 인증은 Function URL(NONE) 대신 여기서 Bearer PAT 로 직접 수행한다.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { authenticate } from "./auth";
import { defaultDocClient, missingTables, tablesFromEnv, type McpContext, type McpTables } from "./context";
import { checkTokenRateLimit } from "./rateLimit";
import { buildMcpServer } from "./server";
import { timingSafeEqual } from "node:crypto";
import { primePublicOrigin } from "./oauth/config";
import { resolveOriginVerify } from "./originVerify";
import { resourceMetadataFor, routeOAuth, type OAuthRouterDeps } from "./oauth/router";

type Result = Exclude<APIGatewayProxyResultV2, string>;

export const MCP_PATH = "/mcp";
/** 요청 본문 상한(UTF-8 바이트). SDK 기본(4MB)보다 좁혀 Lambda 메모리·파싱 비용을 보호한다. */
export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

function jsonRpcError(status: number, code: number, message: string, headers: Record<string, string> = {}): Result {
  return {
    statusCode: status,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
  };
}

function header(event: APIGatewayProxyEventV2, name: string): string | undefined {
  const target = name.toLowerCase();
  const hit = Object.entries(event.headers ?? {}).find(([k]) => k.toLowerCase() === target);
  return hit?.[1];
}

function decodeBody(event: APIGatewayProxyEventV2): string | undefined {
  if (!event.body) return undefined;
  return event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
}

/**
 * 인증·rate limit 전에 본문을 걸러낸다. JSON-RPC 배치(배열)는 한 요청에 최대 100개 호출을 실어
 * 분당 호출 한도를 우회할 수 있어 거부한다. JSON 파싱 오류는 트랜스포트가 표준 오류로 응답한다.
 */
function rejectBody(body: string | undefined): Result | null {
  if (body === undefined) return null;
  if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BODY_BYTES) {
    return jsonRpcError(413, -32600, "Request body too large");
  }
  if (body.trimStart().startsWith("[")) return jsonRpcError(400, -32600, "Batch not supported");
  return null;
}

function toWebRequest(event: APIGatewayProxyEventV2, body: string | undefined): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(event.headers ?? {})) if (v !== undefined) headers.set(k, v);
  const host = event.requestContext?.domainName ?? "localhost";
  const query = event.rawQueryString ? `?${event.rawQueryString}` : "";
  return new Request(`https://${host}${event.rawPath}${query}`, {
    method: event.requestContext.http.method,
    headers,
    body,
  });
}

async function toLambdaResult(res: Response): Promise<Result> {
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });
  return { statusCode: res.status, headers, body: await res.text() };
}

/** CloudFront 가 원본 요청에 싣는 보호 헤더(mcp-edge-construct.ts ORIGIN_VERIFY_HEADER 와 같아야 한다). */
export const ORIGIN_VERIFY_HEADER = "x-qn-origin-verify";

function sameSecret(given: string | undefined, expected: string): boolean {
  const a = Buffer.from(given ?? "", "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type HandlerDeps = {
  doc?: DynamoDBDocumentClient;
  tables?: McpTables;
  collabRoomEpoch?: string;
  /** OAuth 파사드 의존성(테스트 주입). 미지정이면 env 설정. */
  oauth?: Partial<Omit<OAuthRouterDeps, "doc" | "tables">>;
  /** 원본 보호 값(테스트 주입). 미지정이면 Secrets Manager(env ORIGIN_VERIFY_SECRET_ID) — 빈 문자열이면 검사하지 않는다. */
  originVerify?: string;
};

async function serveMcp(event: APIGatewayProxyEventV2, body: string | undefined, ctx: McpContext): Promise<Result> {
  const server = buildMcpServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
  });
  try {
    await server.connect(transport);
    return await toLambdaResult(await transport.handleRequest(toWebRequest(event, body)));
  } finally {
    await server.close().catch(() => undefined);
  }
}

export function createHandler(deps: HandlerDeps = {}) {
  return async (event: APIGatewayProxyEventV2): Promise<Result> => {
    // Function URL 직접 호출 차단 — CloudFront 만 아는 원본 보호 비밀이 맞아야 처리한다.
    const verify = deps.originVerify !== undefined
      ? (deps.originVerify ? { kind: "ready" as const, value: deps.originVerify } : { kind: "disabled" as const })
      : await resolveOriginVerify();
    if (verify.kind === "unavailable") return jsonRpcError(503, -32603, "Server misconfigured");
    if (verify.kind === "ready" && !sameSecret(header(event, ORIGIN_VERIFY_HEADER), verify.value)) {
      return jsonRpcError(403, -32000, "Forbidden");
    }
    // 이 요청이 CloudFront 를 거쳤음이 검증됐을 때만 뷰어 IP 헤더를 신뢰한다(oauth/http.ts clientIp).
    const viaEdge = verify.kind === "ready";
    if (!deps.oauth?.config && !(await primePublicOrigin())) {
      return jsonRpcError(503, -32603, "Server misconfigured");
    }
    // OAuth 2.1 파사드(메타데이터·DCR·authorize·token) — 같은 Function URL origin 에서 처리한다.
    const oauthResult = await routeOAuth(event, {
      doc: deps.doc ?? defaultDocClient(),
      tables: deps.tables ?? tablesFromEnv(),
      ...deps.oauth,
      viaEdge,
    });
    if (oauthResult) return oauthResult;

    const method = event.requestContext.http.method.toUpperCase();
    if (event.rawPath !== MCP_PATH) return jsonRpcError(404, -32000, "Not found");
    if (method !== "POST") return jsonRpcError(405, -32000, "Method not allowed", { allow: "POST" });
    const body = decodeBody(event);
    const rejected = rejectBody(body);
    if (rejected) return rejected;

    const doc = deps.doc ?? defaultDocClient();
    const tables = deps.tables ?? tablesFromEnv();
    const collabRoomEpoch = deps.collabRoomEpoch ?? process.env.COLLAB_ROOM_EPOCH ?? "";
    const missing = missingTables(tables);
    if (missing.length > 0 || !collabRoomEpoch) {
      console.error("mcp 서버 env 미설정", { missing, collabRoomEpoch: Boolean(collabRoomEpoch) });
      return jsonRpcError(500, -32603, "Server misconfigured");
    }

    try {
      const auth = await authenticate({ doc, tables, authorization: header(event, "authorization") });
      if (!auth.ok) {
        // RFC 9728 §5.1: OAuth 클라이언트가 보호 리소스 메타데이터를 찾을 수 있게 한다.
        const metadataUrl = resourceMetadataFor(event, deps.oauth);
        const challenge = metadataUrl
          ? `Bearer realm="quicknote", resource_metadata="${metadataUrl}", error="invalid_token"`
          : 'Bearer realm="quicknote", error="invalid_token"';
        return jsonRpcError(401, -32001, `Unauthorized: ${auth.reason}`, { "www-authenticate": challenge });
      }
      const retryAfter = await checkTokenRateLimit({ doc, tableName: tables.RateLimit, tokenId: auth.token.tokenId });
      if (retryAfter !== null) {
        return jsonRpcError(429, -32002, "Rate limit exceeded", { "retry-after": String(retryAfter) });
      }
      return await serveMcp(event, body, { doc, tables, caller: auth.caller, token: auth.token, collabRoomEpoch });
    } catch (err) {
      console.error("mcp 요청 처리 실패", err);
      return jsonRpcError(500, -32603, "Internal error");
    }
  };
}

export const handler = createHandler();
