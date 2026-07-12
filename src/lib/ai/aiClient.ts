// AI 프록시(Function URL, SSE 스트리밍) 클라이언트.
// 키는 서버에만 있으며, 이 모듈은 Cognito ID 토큰으로 프록시에 인증한다.

import { ensureFreshTokensForAppSync } from "../auth/apiTokens";
import { createSseJsonDecoder } from "./sse";
import type { AiToolCall, AiWireMessage } from "./tools";

export type AiChatMessage = { role: "user" | "assistant"; content: string };

export type AiStreamUsage = { inputTokens: number; outputTokens: number };

export type AiStreamResult = {
  finishReason: string | null;
  usage: AiStreamUsage | null;
  toolCalls: AiToolCall[];
};

export class AiRequestError extends Error {
  status: number | null;
  retryAfterSec: number | null;

  constructor(message: string, status: number | null = null, retryAfterSec: number | null = null) {
    super(message);
    this.name = "AiRequestError";
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

/** 테스트의 vi.stubEnv 대응을 위해 매 호출 시 조회(모듈 로드 시점 고정 회피). */
function aiProxyUrl(): string {
  return ((import.meta.env.VITE_AI_URL as string | undefined) ?? "").trim();
}

export function isAiProxyConfigured(): boolean {
  return aiProxyUrl().length > 0;
}

type SseEvent = {
  delta?: string;
  done?: boolean;
  finishReason?: string | null;
  usage?: AiStreamUsage;
  error?: string;
  retryAfterSec?: number | null;
  tool_call?: AiToolCall;
  toolCalls?: AiToolCall[];
};

export type AiAction = "chat" | "summarize" | "continue" | "translate" | "tone" | "actionItems";

export type AiActionOptions = { targetLanguage?: string; tone?: string };

export async function streamAiChat(args: {
  workspaceId: string;
  pageId?: string | null;
  action?: AiAction;
  options?: AiActionOptions;
  model?: string | null;
  messages: AiWireMessage[];
  context?: { label: string; markdown: string } | null;
  enableTools?: boolean;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  onToolCall?: (call: AiToolCall) => void;
}): Promise<AiStreamResult> {
  const url = aiProxyUrl();
  if (!url) throw new AiRequestError("AI 서버가 설정되지 않았습니다 (VITE_AI_URL)");

  const tokens = await ensureFreshTokensForAppSync();
  if (!tokens?.idToken) throw new AiRequestError("로그인이 필요합니다", 401);

  const res = await fetch(url, {
    method: "POST",
    signal: args.signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${tokens.idToken}`,
    },
    body: JSON.stringify({
      workspaceId: args.workspaceId,
      pageId: args.pageId ?? undefined,
      action: args.action ?? "chat",
      options: args.options ?? undefined,
      model: args.model ?? undefined,
      messages: args.messages,
      context: args.context ?? undefined,
      enableTools: args.enableTools ?? false,
    }),
  });

  if (!res.ok) {
    let message = `AI 요청 실패 (${res.status})`;
    // 표준 Retry-After 헤더 우선 — 비-JSON 에러 본문(게이트웨이 429 등)에서도 값 확보
    let retryAfterSec: number | null = Number(res.headers.get("retry-after")) || null;
    try {
      const body = (await res.json()) as { error?: string; retryAfterSec?: number };
      if (body.error) message = body.error;
      retryAfterSec = body.retryAfterSec ?? retryAfterSec;
    } catch {
      // JSON 아닌 에러 본문은 상태코드 메시지 유지
    }
    throw new AiRequestError(message, res.status, retryAfterSec);
  }
  if (!res.body) throw new AiRequestError("스트리밍 응답 없음");

  const result: AiStreamResult = { finishReason: null, usage: null, toolCalls: [] };
  let streamError: AiRequestError | null = null;
  const seenToolIds = new Set<string>();

  const pushTool = (call: AiToolCall) => {
    if (!call?.id || seenToolIds.has(call.id)) return;
    seenToolIds.add(call.id);
    result.toolCalls.push(call);
    args.onToolCall?.(call);
  };

  const decoder = createSseJsonDecoder((raw) => {
    const event = raw as SseEvent;
    if (typeof event.delta === "string" && event.delta) args.onDelta(event.delta);
    if (event.tool_call) pushTool(event.tool_call);
    if (event.done) {
      result.finishReason = event.finishReason ?? null;
      result.usage = event.usage ?? null;
      for (const tc of event.toolCalls ?? []) pushTool(tc);
    }
    if (event.error) {
      streamError = new AiRequestError(event.error, null, event.retryAfterSec ?? null);
    }
  });

  const reader = res.body.getReader();
  const textDecoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    decoder.push(textDecoder.decode(value, { stream: true }));
  }
  decoder.flush();

  if (streamError) throw streamError;
  return result;
}
