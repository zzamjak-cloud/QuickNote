// AI 프록시 Lambda — Function URL(RESPONSE_STREAM) 로 Gemini 응답을 SSE 로 중계한다.
// 흐름: ① Cognito ID 토큰 검증 → ② 워크스페이스 멤버십(view)·pageId 귀속 확인 →
// ③ per-user 분당 호출 제한 → ④ 워크스페이스 AI 설정·KMS 키 복호화 → ⑤ 스트리밍 → ⑥ 사용량 기록.
// API 키 원문은 이 Lambda 메모리에서만 존재하며 로그·응답에 절대 남기지 않는다.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { KMSClient, DecryptCommand } from "@aws-sdk/client-kms";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import {
  getCallerMember,
  hasWorkspaceViewAccess,
  ResolverError,
  type Member,
} from "../v5-resolvers/handlers/_auth";
import { AI_ALLOWED_MODELS, AI_DEFAULT_MODEL } from "../v5-resolvers/handlers/aiConfig";
import { streamGeminiChat, ProviderError, type AiChatMessage } from "./gemini";
import { buildSystemPrompt, AI_ACTIONS, type AiAction } from "./prompts";
import type { ResponseStream } from "./awslambda";

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const kms = new KMSClient({});

const MEMBERS_TABLE = process.env.MEMBERS_TABLE!;
const MEMBER_TEAMS_TABLE = process.env.MEMBER_TEAMS_TABLE!;
const WORKSPACE_ACCESS_TABLE = process.env.WORKSPACE_ACCESS_TABLE!;
const PAGES_TABLE = process.env.PAGES_TABLE!;
const AI_CONFIG_TABLE = process.env.AI_CONFIG_TABLE!;
const AI_USAGE_TABLE = process.env.AI_USAGE_TABLE!;
const RATE_LIMIT_RPM = Number(process.env.AI_RATE_LIMIT_RPM ?? "10");

// 요청 크기 상한 — 컨텍스트 예산(§6)의 서버측 최종 방어선
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 32_000;
const MAX_CONTEXT_CHARS = 120_000;

// realtime/auth.ts 와 동일한 검증기 구성(웹·데스크톱 클라이언트 콤마 허용)
const allowedClientIds = [process.env.USER_POOL_CLIENT_ID, process.env.USER_POOL_DESKTOP_CLIENT_ID]
  .flatMap((v) => (v ?? "").split(","))
  .map((s) => s.trim())
  .filter(Boolean);
const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.USER_POOL_ID!,
  tokenUse: "id",
  clientId: allowedClientIds,
});

type FnUrlEvent = {
  requestContext?: { http?: { method?: string } };
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
};

type AiChatRequest = {
  workspaceId?: string;
  pageId?: string;
  action?: string;
  model?: string;
  messages?: Array<{ role?: string; content?: string }>;
  context?: { label?: string; markdown?: string };
};

/** 스트림 시작 전 실패 — 상태코드 + JSON 본문으로 즉시 종료. */
function respondJson(
  responseStream: ResponseStream,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  const s = awslambda.HttpResponseStream.from(responseStream, {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
  s.write(JSON.stringify(body));
  s.end();
}

function sseWrite(stream: ResponseStream, payload: Record<string, unknown>): void {
  stream.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/** per-user 분당 호출 제한 — DDB 카운터. 초과 시 다음 분까지 남은 초를 반환. */
async function checkRateLimit(memberId: string): Promise<number | null> {
  const minute = Math.floor(Date.now() / 60_000);
  const r = await doc.send(
    new UpdateCommand({
      TableName: AI_USAGE_TABLE,
      Key: { pk: `rl#${memberId}`, sk: String(minute) },
      UpdateExpression: "ADD cnt :one SET expiresAt = :exp",
      ExpressionAttributeValues: {
        ":one": 1,
        ":exp": Math.floor(Date.now() / 1000) + 180, // TTL 로 자동 정리
      },
      ReturnValues: "ALL_NEW",
    }),
  );
  const cnt = Number(r.Attributes?.cnt ?? 0);
  if (cnt <= RATE_LIMIT_RPM) return null;
  return 60 - Math.floor((Date.now() % 60_000) / 1000);
}

/** 월별·사용자별 사용량 누적 (Phase 3 쿼터/정산의 데이터 소스). 실패해도 응답에 영향 없음. */
async function logUsage(
  workspaceId: string,
  memberId: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  const yyyymm = new Date().toISOString().slice(0, 7).replace("-", "");
  try {
    await doc.send(
      new UpdateCommand({
        TableName: AI_USAGE_TABLE,
        Key: { pk: `usage#${workspaceId}`, sk: `${yyyymm}#${memberId}` },
        UpdateExpression: "ADD requestCount :one, inputTokens :i, outputTokens :o",
        ExpressionAttributeValues: { ":one": 1, ":i": inputTokens, ":o": outputTokens },
      }),
    );
  } catch (e) {
    console.error("ai usage 기록 실패", e);
  }
}

async function decryptApiKey(apiKeyEnc: string): Promise<string> {
  const r = await kms.send(
    new DecryptCommand({ CiphertextBlob: Buffer.from(apiKeyEnc, "base64") }),
  );
  if (!r.Plaintext) throw new Error("KMS 복호화 실패");
  return Buffer.from(r.Plaintext).toString("utf-8");
}

/** 인증·인가·설정 로드. 실패 시 { status, error } 반환(원문 키는 성공 시에만). */
async function authorize(event: FnUrlEvent, req: AiChatRequest): Promise<
  | { ok: true; caller: Member; apiKey: string; defaultModel: string }
  | { ok: false; status: number; error: string }
> {
  const authHeader = event.headers?.authorization ?? event.headers?.Authorization ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return { ok: false, status: 401, error: "인증 토큰 없음" };

  let cognitoSub: string;
  try {
    const payload = await verifier.verify(token);
    cognitoSub = payload.sub;
  } catch {
    return { ok: false, status: 401, error: "토큰 검증 실패" };
  }

  const workspaceId = req.workspaceId ?? "";
  if (!workspaceId) return { ok: false, status: 400, error: "workspaceId 필요" };

  let caller: Member;
  try {
    caller = await getCallerMember(doc, MEMBERS_TABLE, cognitoSub);
    const allowed = await hasWorkspaceViewAccess({
      doc,
      memberTeamsTableName: MEMBER_TEAMS_TABLE,
      workspaceAccessTableName: WORKSPACE_ACCESS_TABLE,
      caller,
      workspaceId,
    });
    if (!allowed) return { ok: false, status: 403, error: "워크스페이스 접근 권한 없음" };
  } catch (e) {
    if (e instanceof ResolverError) return { ok: false, status: 403, error: e.message };
    throw e;
  }

  // pageId 가 오면 해당 페이지의 워크스페이스 귀속을 검증 (교차 워크스페이스 위장 차단)
  if (req.pageId) {
    const page = await doc.send(
      new GetCommand({
        TableName: PAGES_TABLE,
        Key: { id: req.pageId },
        ProjectionExpression: "workspaceId",
      }),
    );
    if (!page.Item || page.Item.workspaceId !== workspaceId) {
      return { ok: false, status: 403, error: "페이지 접근 권한 없음" };
    }
  }

  const cfg = await doc.send(
    new GetCommand({ TableName: AI_CONFIG_TABLE, Key: { workspaceId } }),
  );
  const item = cfg.Item as
    | { enabled?: boolean; apiKeyEnc?: string; defaultModel?: string }
    | undefined;
  if (!item?.enabled || !item.apiKeyEnc) {
    return { ok: false, status: 403, error: "이 워크스페이스에서 AI 가 비활성화되어 있습니다" };
  }

  const apiKey = await decryptApiKey(item.apiKeyEnc);
  return { ok: true, caller, apiKey, defaultModel: item.defaultModel ?? AI_DEFAULT_MODEL };
}

function validateRequest(req: AiChatRequest):
  | { ok: true; action: AiAction; messages: AiChatMessage[] }
  | { ok: false; error: string } {
  const action = (req.action ?? "chat") as AiAction;
  if (!(AI_ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, error: `지원하지 않는 action: ${req.action}` };
  }
  const raw = Array.isArray(req.messages) ? req.messages : [];
  if (raw.length === 0) return { ok: false, error: "messages 필요" };
  if (raw.length > MAX_MESSAGES) return { ok: false, error: "대화가 너무 깁니다" };
  const messages: AiChatMessage[] = [];
  for (const m of raw) {
    if ((m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") {
      return { ok: false, error: "잘못된 메시지 형식" };
    }
    if (m.content.length > MAX_MESSAGE_CHARS) return { ok: false, error: "메시지가 너무 깁니다" };
    messages.push({ role: m.role, content: m.content });
  }
  if ((req.context?.markdown?.length ?? 0) > MAX_CONTEXT_CHARS) {
    return { ok: false, error: "컨텍스트가 너무 큽니다" };
  }
  return { ok: true, action, messages };
}

export const handler = awslambda.streamifyResponse<FnUrlEvent>(
  async (event, responseStream) => {
    try {
      if (event.requestContext?.http?.method !== "POST") {
        respondJson(responseStream, 405, { error: "POST 만 지원" });
        return;
      }
      let req: AiChatRequest;
      try {
        const raw = event.isBase64Encoded
          ? Buffer.from(event.body ?? "", "base64").toString("utf-8")
          : event.body ?? "";
        req = JSON.parse(raw) as AiChatRequest;
      } catch {
        respondJson(responseStream, 400, { error: "잘못된 JSON 본문" });
        return;
      }

      const valid = validateRequest(req);
      if (!valid.ok) {
        respondJson(responseStream, 400, { error: valid.error });
        return;
      }

      const auth = await authorize(event, req);
      if (!auth.ok) {
        respondJson(responseStream, auth.status, { error: auth.error });
        return;
      }

      const retryAfter = await checkRateLimit(auth.caller.memberId);
      if (retryAfter != null) {
        respondJson(responseStream, 429, {
          error: "요청이 너무 잦습니다. 잠시 후 다시 시도하세요.",
          retryAfterSec: retryAfter,
        });
        return;
      }

      const model =
        req.model && (AI_ALLOWED_MODELS as readonly string[]).includes(req.model)
          ? req.model
          : auth.defaultModel;

      const stream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          "x-accel-buffering": "no",
        },
      });

      try {
        const result = await streamGeminiChat({
          apiKey: auth.apiKey,
          model,
          systemPrompt: buildSystemPrompt(valid.action, req.context),
          messages: valid.messages,
          onDelta: (text) => sseWrite(stream, { delta: text }),
        });
        sseWrite(stream, {
          done: true,
          finishReason: result.finishReason,
          usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
        });
        await logUsage(
          req.workspaceId!,
          auth.caller.memberId,
          result.inputTokens,
          result.outputTokens,
        );
      } catch (e) {
        // 스트림이 이미 열렸으므로 에러도 SSE 이벤트로 전달
        if (e instanceof ProviderError) {
          sseWrite(stream, {
            error: e.status === 429 ? "AI 제공사 사용량 한도에 걸렸습니다" : e.message,
            retryAfterSec: e.retryAfterSec,
          });
        } else {
          console.error("ai-proxy 스트리밍 오류", e);
          sseWrite(stream, { error: "AI 응답 중 오류가 발생했습니다" });
        }
      } finally {
        stream.end();
      }
    } catch (e) {
      console.error("ai-proxy 처리 실패", e);
      respondJson(responseStream, 500, { error: "서버 오류" });
    }
  },
);
