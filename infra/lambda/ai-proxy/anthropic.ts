// Anthropic Messages API 직접 호출(공식 SDK 스트리밍) — Claude API 키가 등록된 경우
// 화이트리스트의 anthropic/* 모델을 OpenRouter 대신 이 경로로 보낸다.
import Anthropic from "@anthropic-ai/sdk";
import { ProviderError, type AiStreamResult } from "./provider";
import {
  anthropicTools,
  type AiAnthropicContentBlock,
  type AiToolCall,
  type AiWireMessage,
} from "./tools";

import Beta = Anthropic.Beta;

/**
 * 모델별 호출 규약. 저장·전송 ID 는 OpenRouter slug 하나로 유지하고 네이티브 ID 는 여기서만 쓴다.
 * - off: thinking 을 끈다(Haiku 4.5 는 생략 = 꺼짐, Sonnet 5 는 생략 = adaptive 라 disabled 명시).
 * - adaptive: thinking 을 끌 수 없는 모델. 도구 턴 콘텐츠 원문 왕복으로 thinking 블록을 보존한다.
 */
type ClaudeModelSpec =
  | { native: string; thinking: "off"; sendDisabled: boolean }
  | { native: string; thinking: "adaptive"; effort: "low" | "medium" | "high" };

const CLAUDE_MODELS: Record<string, ClaudeModelSpec> = {
  "anthropic/claude-haiku-4.5": { native: "claude-haiku-4-5", thinking: "off", sendDisabled: false },
  "anthropic/claude-sonnet-5": { native: "claude-sonnet-5", thinking: "off", sendDisabled: true },
  // 노트 대화·요약·도구 조회 위주라 medium 을 명시한다(Opus 5.5 기본 medium, Sonnet 5.5 기본 high).
  "anthropic/claude-sonnet-5.5": { native: "claude-sonnet-5-5", thinking: "adaptive", effort: "medium" },
  "anthropic/claude-opus-5.5": { native: "claude-opus-5-5", thinking: "adaptive", effort: "medium" },
};

/**
 * adaptive 모델 전용 베타:
 * - server-side-fallback: 안전 분류기 거절 시 같은 호출 안에서 대체 모델로 이어간다.
 * - thinking-binding-controls: 되돌린 thinking 블록이 대화 검증에 실패하면 400 대신 블록만 버린다.
 */
const ADAPTIVE_BETAS: Beta.AnthropicBeta[] = [
  "server-side-fallback-2026-07-01",
  "thinking-binding-controls-2026-08-01",
];

export function nativeAnthropicModelId(slug: string): string | null {
  return CLAUDE_MODELS[slug]?.native ?? null;
}

/** thinking 을 끈 모델이 도구 호출을 본문 텍스트로 흘리는 현상을 막는 지침. */
const THINKING_OFF_TOOL_HINT =
  "When you use a tool, you may say a brief sentence first. If no tool can express what the user asked for, say so instead of guessing. Do not include internal or system XML tags in your response.";

function toAnthropicMessages(messages: AiWireMessage[]): Beta.BetaMessageParam[] {
  const out: Beta.BetaMessageParam[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      if (m.images && m.images.length > 0) {
        // 이미지 첨부는 텍스트 앞에 배치 (제공사 권장 순서)
        out.push({
          role: "user",
          content: [
            ...m.images.map(
              (img): Beta.BetaImageBlockParam => ({
                type: "image",
                source: {
                  type: "base64",
                  media_type: img.mimeType as Beta.BetaBase64ImageSource["media_type"],
                  data: img.dataBase64,
                },
              }),
            ),
            // 이미지 전용 메시지의 빈 텍스트 블록은 API 가 거절한다.
            ...(m.content.trim() ? [{ type: "text" as const, text: m.content }] : []),
          ],
        });
        continue;
      }
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      // 빈 assistant 텍스트는 API 가 거절한다(도구만 호출한 턴의 잔여물).
      if (m.content.trim()) out.push({ role: "assistant", content: m.content });
    } else if (m.role === "assistant_tools") {
      out.push({
        role: "assistant",
        // thinking 블록이 있는 턴은 서버가 내려준 원문을 그대로 되돌린다(수정 시 무효화).
        content: m.anthropicContent
          ? (m.anthropicContent as unknown as Beta.BetaContentBlockParam[])
          : m.toolCalls.map(
              (tc): Beta.BetaToolUseBlockParam => ({
                type: "tool_use",
                id: tc.id,
                name: tc.name,
                input: tc.args,
              }),
            ),
      });
    } else if (m.role === "tool") {
      const block: Beta.BetaToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: m.toolCallId,
        content: m.content,
      };
      // 연속된 도구 결과는 한 user 메시지에 모아야 병렬 호출이 유지된다.
      const last = out[out.length - 1];
      if (last?.role === "user" && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    }
  }
  // 히스토리 상한으로 잘린 대화가 assistant 로 시작하면 API 가 거절한다(첫 메시지는 user).
  const firstUser = out.findIndex((m) => m.role === "user");
  return firstUser > 0 ? out.slice(firstUser) : out;
}

/**
 * 응답 콘텐츠 → 다음 라운드로 되돌릴 블록. 대체 모델 전환(fallback 블록)이 있으면 마지막 fallback
 * 이전의 thinking·tool_use 등 모델 내부 블록은 빼고 text·fallback 블록만 제자리에 남긴다.
 */
export function echoableContent(content: Beta.BetaContentBlock[]): Beta.BetaContentBlock[] {
  const boundary = content.map((b) => b.type).lastIndexOf("fallback");
  return content.filter(
    (b, i) => i > boundary || b.type === "text" || b.type === "fallback",
  );
}

function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  // 클라이언트 끊김으로 인한 중단 — 호출부가 조용히 종료하므로 로그를 남기지 않는다.
  if (e instanceof Anthropic.APIUserAbortError) {
    return new ProviderError("요청이 취소되었습니다", 499, null);
  }
  if (e instanceof Anthropic.APIError) {
    const status = typeof e.status === "number" ? e.status : 502;
    const retryAfter = Number(e.headers?.get?.("retry-after")) || null;
    console.error("anthropic upstream error", status, String(e.message).slice(0, 300));
    return new ProviderError(`AI 제공사 오류 (${status})`, status, retryAfter);
  }
  return new ProviderError("Anthropic 스트리밍 오류", 502, null);
}

function buildParams(
  spec: ClaudeModelSpec,
  args: {
    instructions: string;
    contextBlock?: string | null;
    messages: AiWireMessage[];
    enableTools?: boolean;
  },
): Beta.MessageCreateParamsNonStreaming {
  const thinkingOff = spec.thinking === "off";
  const instructions =
    args.enableTools && thinkingOff
      ? `${args.instructions}\n\n${THINKING_OFF_TOOL_HINT}`
      : args.instructions;
  const contextBlock = args.contextBlock?.trim() || null;
  // 컨텍스트를 system 두 번째 블록에 두고 캐시 — 멀티턴·도구 왕복의 반복 입력 비용 절감.
  // 도구 라운드 사이에 system·tools 가 바뀌면 thinking 블록이 무효화되므로 결정적으로 만든다.
  const system: Beta.BetaTextBlockParam[] = [{ type: "text", text: instructions }];
  if (contextBlock) {
    system.push({ type: "text", text: contextBlock, cache_control: { type: "ephemeral" } });
  }

  const params: Beta.MessageCreateParamsNonStreaming = {
    model: spec.native,
    // 출력 상한 — 화이트리스트 Claude 모델 중 Haiku 4.5(64,000)가 가장 낮다.
    max_tokens: 64_000,
    system,
    messages: toAnthropicMessages(args.messages),
  };
  if (spec.thinking === "off") {
    if (spec.sendDisabled) params.thinking = { type: "disabled" };
  } else {
    params.thinking = {
      type: "adaptive",
      block_binding: { prefix_mismatch_behavior: "drop_block" },
    };
    params.output_config = { effort: spec.effort };
    params.fallbacks = "default";
    params.betas = ADAPTIVE_BETAS;
  }
  if (args.enableTools) params.tools = anthropicTools() as unknown as Beta.BetaTool[];
  return params;
}

export async function streamAnthropicChat(args: {
  apiKey: string;
  /** OpenRouter slug(anthropic/*). 내부에서 네이티브 ID 로 변환한다. */
  model: string;
  /** 고정 지침 — 캐시 프리픽스 앞부분. */
  instructions: string;
  /** <context>… 블록. 있으면 ephemeral 캐시 대상. */
  contextBlock?: string | null;
  messages: AiWireMessage[];
  enableTools?: boolean;
  /** 클라이언트 끊김 시 upstream 도 중단해 토큰 소모를 멈춘다 */
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  onToolCall?: (call: AiToolCall) => void;
}): Promise<AiStreamResult> {
  const spec = CLAUDE_MODELS[args.model];
  if (!spec) throw new ProviderError(`지원하지 않는 Claude 모델: ${args.model}`, 400, null);

  // 키가 다른 호스트로 새지 않도록 baseURL 을 고정한다(ANTHROPIC_BASE_URL 무시).
  // SDK 재시도는 Lambda 시간만 쓰고 클라이언트가 이미 재시도 UX 를 가지므로 끈다.
  const client = new Anthropic({
    apiKey: args.apiKey,
    baseURL: "https://api.anthropic.com",
    maxRetries: 0,
  });
  let message: Beta.BetaMessage;
  try {
    const stream = client.beta.messages.stream(buildParams(spec, args), {
      signal: args.signal,
    });
    stream.on("text", (text) => args.onDelta(text));
    message = await stream.finalMessage();
  } catch (e) {
    throw toProviderError(e);
  }

  // 대체 모델까지 모두 거절 — 부분 응답을 정상 답변처럼 두지 않고 오류로 알린다.
  if (message.stop_reason === "refusal") {
    throw new ProviderError("Claude 가 안전 정책에 따라 이 요청에 응답하지 않았습니다", 400, null);
  }

  const echo = echoableContent(message.content);
  const toolCalls: AiToolCall[] = [];
  for (const block of echo) {
    if (block.type !== "tool_use") continue;
    const call: AiToolCall = {
      id: block.id,
      name: block.name,
      args: (block.input ?? {}) as Record<string, unknown>,
    };
    toolCalls.push(call);
    args.onToolCall?.(call);
  }

  // 최상위 usage 가 대체 모델 반복까지 포함한 청구 합계다. 캐시 토큰도 월 한도에 합산한다.
  const usage = message.usage;
  return {
    inputTokens:
      (usage.input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens ?? 0,
    finishReason: message.stop_reason ?? (toolCalls.length > 0 ? "tool_use" : null),
    toolCalls,
    // 도구 턴만 되돌린다. 최종 답변 턴은 다음 질문에서 텍스트로만 이어간다
    // (앞쪽 thinking 블록을 통째로 빼는 것은 대화 검증에서 허용된다).
    anthropicContent:
      toolCalls.length > 0 ? (echo as unknown as AiAnthropicContentBlock[]) : undefined,
  };
}
