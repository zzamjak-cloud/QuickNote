// AI 프록시 Lambda — Function URL(RESPONSE_STREAM) 로 제공사 응답을 SSE 로 중계한다.
// 흐름: ① Cognito ID 토큰 검증 → ② 워크스페이스 멤버십(view)·pageId 귀속 확인 →
// ③ per-user 분당 호출 제한 → ④ 월 토큰 쿼터 → ⑤ 워크스페이스 AI 설정·KMS 키 복호화 →
// ⑥ 제공사별 스트리밍 → ⑦ 사용량 기록(멤버 + __total).
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
import {
  AI_DEFAULT_MODEL_BY_PROVIDER,
  AI_MODELS_BY_PROVIDER,
  GLOBAL_AI_CONFIG_ID,
  providerForModel,
  providersWithKeys,
  resolveKeysMap,
  type AiProvider,
} from "../v5-resolvers/handlers/aiConfig";
import { streamGeminiChat, ProviderError } from "./gemini";
import { streamAnthropicChat } from "./anthropic";
import { streamOpenAiChat } from "./openai";
import {
  buildSystemPromptParts,
  AI_ACTIONS,
  AI_TONES,
  type AiAction,
  type AiActionOptions,
} from "./prompts";
import {
  TOOLS_SYSTEM_HINT,
  type AiGeminiHistoryPart,
  type AiImageAttachment,
  type AiToolCall,
  type AiWireMessage,
} from "./tools";
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
// tool 왕복(assistant_tools + tool) 포함해 여유를 둔다
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 32_000;
const MAX_TOTAL_MESSAGE_CHARS = 200_000;
const MAX_CONTEXT_CHARS = 120_000;
const MAX_TOOL_RESULT_CHARS = 24_000;
const MAX_THOUGHT_SIGNATURE_CHARS = 32_000;
const MAX_TOOL_CALLS_PER_MESSAGE = 20;
const MAX_TOOL_CALL_ID_CHARS = 4_096;
const MAX_TOOL_NAME_CHARS = 128;
const MAX_TOOL_ARGS_CHARS = 32_000;
const MAX_GEMINI_HISTORY_PARTS = 200;
// 이미지 첨부 — Lambda 요청 페이로드 6MB 제한 내 여유
const IMAGE_MIME_WHITELIST = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_IMAGES_PER_MESSAGE = 4;
const MAX_IMAGE_B64_CHARS = 3_000_000; // ≈ 2.2MB 원본
const MAX_TOTAL_IMAGE_B64_CHARS = 5_000_000;

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
  messages?: Array<{
    role?: string;
    content?: string;
    images?: Array<{ mimeType?: string; dataBase64?: string }>;
    geminiParts?: Array<{
      text?: string;
      thought?: boolean;
      thoughtSignature?: string;
    }>;
    toolCalls?: Array<{
      id?: string;
      name?: string;
      args?: Record<string, unknown>;
      thoughtSignature?: string;
    }>;
    toolCallId?: string;
    name?: string;
  }>;
  context?: { label?: string; markdown?: string };
  options?: { targetLanguage?: string; tone?: string };
  /** chat 전용 — 클라이언트가 로컬 스토어로 해석할 tool schema 활성화 */
  enableTools?: boolean;
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

function currentYyyymm(): string {
  return new Date().toISOString().slice(0, 7).replace("-", "");
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

/**
 * 월 토큰 쿼터 사전 검사 — 전역 설정이므로 전역 누적(usage#__global__) 기준. limit=0 이면 무제한.
 * 초과 시 true(차단). 조회 실패는 통과(가용성 우선 — 기록은 별도 경로).
 */
async function isMonthlyQuotaExceeded(monthlyTokenLimit: number): Promise<boolean> {
  if (!monthlyTokenLimit || monthlyTokenLimit <= 0) return false;
  try {
    const yyyymm = currentYyyymm();
    const r = await doc.send(
      new GetCommand({
        TableName: AI_USAGE_TABLE,
        Key: { pk: `usage#${GLOBAL_AI_CONFIG_ID}`, sk: `${yyyymm}#__total` },
        ProjectionExpression: "inputTokens, outputTokens",
      }),
    );
    const used =
      Number(r.Item?.inputTokens ?? 0) + Number(r.Item?.outputTokens ?? 0);
    return used >= monthlyTokenLimit;
  } catch (e) {
    console.error("ai monthly quota 조회 실패", e);
    return false;
  }
}

/** 월별·사용자별 + 워크스페이스 총합(__total) + 전역 총합 사용량 누적. 실패해도 응답에 영향 없음. */
async function logUsage(
  workspaceId: string,
  memberId: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  const yyyymm = currentYyyymm();
  const values = { ":one": 1, ":i": inputTokens, ":o": outputTokens };
  const expr = "ADD requestCount :one, inputTokens :i, outputTokens :o";
  const upsert = (pk: string, sk: string) =>
    doc.send(
      new UpdateCommand({
        TableName: AI_USAGE_TABLE,
        Key: { pk, sk },
        UpdateExpression: expr,
        ExpressionAttributeValues: values,
      }),
    );
  try {
    await Promise.all([
      upsert(`usage#${workspaceId}`, `${yyyymm}#${memberId}`),
      upsert(`usage#${workspaceId}`, `${yyyymm}#__total`),
      // 전역 총합 — 월 쿼터(monthlyTokenLimit)가 전역 설정이므로 전역 기준으로 집계
      upsert(`usage#${GLOBAL_AI_CONFIG_ID}`, `${yyyymm}#__total`),
    ]);
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

type AuthOk = {
  ok: true;
  caller: Member;
  /** 제공사별 암호문(복호화는 모델 확정 후). */
  keys: ReturnType<typeof resolveKeysMap>;
  defaultModel: string;
  monthlyTokenLimit: number;
};

/** 인증·인가·설정 로드. 키 복호화는 모델 확정 후 수행. */
async function authorize(
  event: FnUrlEvent,
  req: AiChatRequest,
): Promise<AuthOk | { ok: false; status: number; error: string }> {
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

  // AI 설정은 전역 공유 — 전역 아이템 우선, 없으면 레거시(워크스페이스별) 폴백
  let cfg = await doc.send(
    new GetCommand({ TableName: AI_CONFIG_TABLE, Key: { workspaceId: GLOBAL_AI_CONFIG_ID } }),
  );
  if (!cfg.Item) {
    cfg = await doc.send(
      new GetCommand({ TableName: AI_CONFIG_TABLE, Key: { workspaceId } }),
    );
  }
  const item = cfg.Item as
    | {
        enabled?: boolean;
        apiKeyEnc?: string;
        apiKeyLast4?: string;
        provider?: string;
        keys?: Partial<Record<AiProvider, { enc: string; last4: string }>>;
        defaultModel?: string;
        monthlyTokenLimit?: number;
      }
    | undefined;

  const keys = resolveKeysMap(item);
  const withKey = providersWithKeys(keys);
  if (!item?.enabled || withKey.length === 0) {
    return { ok: false, status: 403, error: "이 워크스페이스에서 AI 가 비활성화되어 있습니다" };
  }

  const allowedModels = withKey.flatMap((p) => [...AI_MODELS_BY_PROVIDER[p]]);
  const defaultModel =
    item.defaultModel && allowedModels.includes(item.defaultModel)
      ? item.defaultModel
      : AI_DEFAULT_MODEL_BY_PROVIDER[withKey[0] ?? "gemini"];

  return {
    ok: true,
    caller,
    keys,
    defaultModel,
    monthlyTokenLimit: item.monthlyTokenLimit ?? 0,
  };
}

function validateRequest(req: AiChatRequest):
  | {
      ok: true;
      action: AiAction;
      messages: AiWireMessage[];
      options: AiActionOptions;
      enableTools: boolean;
    }
  | { ok: false; error: string } {
  const action = (req.action ?? "chat") as AiAction;
  if (!(AI_ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, error: `지원하지 않는 action: ${req.action}` };
  }
  const options: AiActionOptions = {};
  if (req.options?.targetLanguage != null) {
    const lang = String(req.options.targetLanguage).replace(/[\n\r"<>]/g, "").trim();
    if (!lang || lang.length > 40) return { ok: false, error: "잘못된 targetLanguage" };
    options.targetLanguage = lang;
  }
  if (req.options?.tone != null) {
    if (!(AI_TONES as readonly string[]).includes(req.options.tone)) {
      return { ok: false, error: `지원하지 않는 tone: ${req.options.tone}` };
    }
    options.tone = req.options.tone;
  }
  const enableTools = Boolean(req.enableTools) && action === "chat";
  const raw = Array.isArray(req.messages) ? req.messages : [];
  if (raw.length === 0) return { ok: false, error: "messages 필요" };
  if (raw.length > MAX_MESSAGES) return { ok: false, error: "대화가 너무 깁니다" };
  const messages: AiWireMessage[] = [];
  let totalImageChars = 0;
  for (const m of raw) {
    if (m.role === "user" || m.role === "assistant") {
      if (typeof m.content !== "string") return { ok: false, error: "잘못된 메시지 형식" };
      if (m.content.length > MAX_MESSAGE_CHARS) return { ok: false, error: "메시지가 너무 깁니다" };
      // 이미지 첨부 검증 — user 메시지만, 형식·개수·크기 상한
      if (m.role === "user" && Array.isArray(m.images) && m.images.length > 0) {
        if (m.images.length > MAX_IMAGES_PER_MESSAGE) {
          return { ok: false, error: `이미지는 메시지당 최대 ${MAX_IMAGES_PER_MESSAGE}장` };
        }
        const images: AiImageAttachment[] = [];
        for (const img of m.images) {
          if (
            typeof img?.mimeType !== "string" ||
            !IMAGE_MIME_WHITELIST.has(img.mimeType) ||
            typeof img?.dataBase64 !== "string" ||
            img.dataBase64.length === 0
          ) {
            return { ok: false, error: "지원하지 않는 이미지 형식" };
          }
          if (img.dataBase64.length > MAX_IMAGE_B64_CHARS) {
            return { ok: false, error: "이미지가 너무 큽니다" };
          }
          totalImageChars += img.dataBase64.length;
          if (totalImageChars > MAX_TOTAL_IMAGE_B64_CHARS) {
            return { ok: false, error: "이미지 첨부 총량이 너무 큽니다" };
          }
          images.push({ mimeType: img.mimeType, dataBase64: img.dataBase64 });
        }
        messages.push({ role: "user", content: m.content, images });
        continue;
      }
      if (m.role === "assistant" && m.geminiParts !== undefined) {
        if (
          !Array.isArray(m.geminiParts) ||
          m.geminiParts.length === 0 ||
          m.geminiParts.length > MAX_GEMINI_HISTORY_PARTS
        ) {
          return { ok: false, error: "잘못된 Gemini 응답 파트" };
        }
        const geminiParts: AiGeminiHistoryPart[] = [];
        let joinedText = "";
        for (const part of m.geminiParts) {
          if (
            !part ||
            (part.text !== undefined && typeof part.text !== "string") ||
            (part.thought !== undefined && typeof part.thought !== "boolean") ||
            (part.thoughtSignature !== undefined &&
              (typeof part.thoughtSignature !== "string" ||
                part.thoughtSignature.length > MAX_THOUGHT_SIGNATURE_CHARS)) ||
            (part.text === undefined && !part.thoughtSignature)
          ) {
            return { ok: false, error: "잘못된 Gemini 응답 파트" };
          }
          const text = part.text ?? "";
          joinedText += text;
          geminiParts.push({
            ...(part.text !== undefined ? { text } : {}),
            ...(part.thought !== undefined ? { thought: part.thought } : {}),
            ...(part.thoughtSignature !== undefined
              ? { thoughtSignature: part.thoughtSignature }
              : {}),
          });
        }
        if (joinedText !== m.content) {
          return { ok: false, error: "Gemini 응답 파트와 본문이 일치하지 않습니다" };
        }
        messages.push({ role: "assistant", content: m.content, geminiParts });
      } else {
        messages.push({ role: m.role, content: m.content });
      }
      continue;
    }
    if (m.role === "assistant_tools") {
      if (!enableTools) return { ok: false, error: "도구 메시지는 enableTools 필요" };
      if ((m.toolCalls?.length ?? 0) > MAX_TOOL_CALLS_PER_MESSAGE) {
        return { ok: false, error: "도구 호출이 너무 많습니다" };
      }
      const toolCalls: AiToolCall[] = [];
      for (const tc of m.toolCalls ?? []) {
        if (
          typeof tc?.id !== "string" ||
          tc.id.length === 0 ||
          tc.id.length > MAX_TOOL_CALL_ID_CHARS ||
          typeof tc.name !== "string" ||
          tc.name.length === 0 ||
          tc.name.length > MAX_TOOL_NAME_CHARS
        ) {
          return { ok: false, error: "잘못된 toolCalls" };
        }
        if (
          tc.thoughtSignature !== undefined &&
          (typeof tc.thoughtSignature !== "string" ||
            tc.thoughtSignature.length > MAX_THOUGHT_SIGNATURE_CHARS)
        ) {
          return { ok: false, error: "잘못된 thoughtSignature" };
        }
        const args = tc.args && typeof tc.args === "object" ? tc.args : {};
        if (JSON.stringify(args).length > MAX_TOOL_ARGS_CHARS) {
          return { ok: false, error: "도구 인자가 너무 큽니다" };
        }
        toolCalls.push({
          // Gemini 3.x 호출 ID는 모델이 발급한 값을 정확히 되돌려줘야 한다.
          id: tc.id,
          name: tc.name,
          args,
          ...(tc.thoughtSignature !== undefined
            ? { thoughtSignature: tc.thoughtSignature }
            : {}),
        });
      }
      if (toolCalls.length === 0) return { ok: false, error: "toolCalls 필요" };
      messages.push({ role: "assistant_tools", toolCalls });
      continue;
    }
    if (m.role === "tool") {
      if (!enableTools) return { ok: false, error: "도구 메시지는 enableTools 필요" };
      if (
        typeof m.toolCallId !== "string" ||
        m.toolCallId.length === 0 ||
        m.toolCallId.length > MAX_TOOL_CALL_ID_CHARS ||
        typeof m.name !== "string" ||
        m.name.length === 0 ||
        m.name.length > MAX_TOOL_NAME_CHARS ||
        typeof m.content !== "string"
      ) {
        return { ok: false, error: "잘못된 tool 결과" };
      }
      if (m.content.length > MAX_TOOL_RESULT_CHARS) {
        return { ok: false, error: "tool 결과가 너무 깁니다" };
      }
      messages.push({
        role: "tool",
        toolCallId: m.toolCallId,
        name: m.name,
        content: m.content,
      });
      continue;
    }
    return { ok: false, error: "잘못된 메시지 형식" };
  }
  // 메시지 합산 상한 — 본문뿐 아니라 도구 인자·ID·추론 서명도 포함한다.
  // 이미지는 별도 개수·총 base64 상한으로 검증한다.
  const totalChars = messages.reduce(
    (sum, m) => {
      if (m.role === "assistant_tools") {
        return sum + JSON.stringify(m.toolCalls).length;
      }
      if (m.role === "tool") {
        return sum + m.toolCallId.length + m.name.length + m.content.length;
      }
      if (m.role === "assistant" && m.geminiParts) {
        return sum + m.content.length + JSON.stringify(m.geminiParts).length;
      }
      return sum + m.content.length;
    },
    0,
  );
  if (totalChars > MAX_TOTAL_MESSAGE_CHARS) {
    return { ok: false, error: "대화 내용이 너무 큽니다" };
  }
  if ((req.context?.markdown?.length ?? 0) > MAX_CONTEXT_CHARS) {
    return { ok: false, error: "컨텍스트가 너무 큽니다" };
  }
  // context.label 은 프롬프트의 <context label="…"> 속성으로 삽입되므로 정제 필수
  if (req.context?.label != null) {
    req.context.label = String(req.context.label).replace(/[\n\r"<>]/g, "").slice(0, 120);
  }
  return { ok: true, action, messages, options, enableTools };
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

      if (await isMonthlyQuotaExceeded(auth.monthlyTokenLimit)) {
        respondJson(responseStream, 429, {
          error: "이번 달 AI 토큰 한도에 도달했습니다. 설정에서 한도를 확인하세요.",
        });
        return;
      }

      // 요청 모델 → 제공사 → 해당 키. 키가 있는 제공사 모델만 허용.
      const keyedProviders = providersWithKeys(auth.keys);
      const allowedModels = keyedProviders.flatMap((p) => [...AI_MODELS_BY_PROVIDER[p]]);
      const model =
        req.model && allowedModels.includes(req.model) ? req.model : auth.defaultModel;
      const provider = providerForModel(model);
      if (!provider || !auth.keys[provider]?.enc) {
        respondJson(responseStream, 403, {
          error: "선택한 모델용 API 키가 등록되어 있지 않습니다",
        });
        return;
      }
      const apiKey = await decryptApiKey(auth.keys[provider]!.enc);

      const { instructions: baseInstructions, contextBlock } = buildSystemPromptParts(
        valid.action,
        req.context,
        valid.options,
      );
      const instructions = valid.enableTools
        ? `${baseInstructions}\n\n${TOOLS_SYSTEM_HINT}`
        : baseInstructions;
      // Gemini 는 단일 systemInstruction 문자열(지침+컨텍스트 고정 프리픽스) —
      // Anthropic 은 contextBlock 에 ephemeral cache_control
      const systemPrompt = contextBlock
        ? `${instructions}\n\n${contextBlock}`
        : instructions;

      const stream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          "x-accel-buffering": "no",
        },
      });

      // 클라이언트가 끊으면 제공사 스트림도 중단 — 유령 토큰 소모 방지
      const upstreamAbort = new AbortController();
      responseStream.on?.("close", () => upstreamAbort.abort());
      responseStream.on?.("error", () => upstreamAbort.abort());

      try {
        const onToolCall = (call: AiToolCall) => sseWrite(stream, { tool_call: call });
        const common = {
          apiKey,
          model,
          messages: valid.messages,
          enableTools: valid.enableTools,
          signal: upstreamAbort.signal,
          onDelta: (text: string) => sseWrite(stream, { delta: text }),
          onToolCall,
        };
        const result =
          provider === "anthropic"
            ? await streamAnthropicChat({ ...common, instructions, contextBlock })
            : provider === "openai"
              ? await streamOpenAiChat({ ...common, systemPrompt })
              : await streamGeminiChat({ ...common, systemPrompt });
        sseWrite(stream, {
          done: true,
          finishReason: result.finishReason,
          usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
          toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
          geminiParts: result.geminiParts?.length ? result.geminiParts : undefined,
        });
        await logUsage(
          req.workspaceId!,
          auth.caller.memberId,
          result.inputTokens,
          result.outputTokens,
        );
      } catch (e) {
        // 클라이언트가 끊어서 중단된 경우 — 쓸 곳이 없으므로 조용히 종료
        if (upstreamAbort.signal.aborted) {
          return;
        }
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
        try {
          stream.end();
        } catch {
          // 이미 끊긴 스트림 — 무시
        }
      }
    } catch (e) {
      console.error("ai-proxy 처리 실패", e);
      respondJson(responseStream, 500, { error: "서버 오류" });
    }
  },
);
