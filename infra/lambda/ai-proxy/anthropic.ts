// Anthropic Messages API(SSE 스트리밍) 호출 — gemini.ts 와 동일한 인터페이스.
// (프록시 특성상 SDK 번들 없이 raw fetch 로 SSE pass-through — Gemini 어댑터와 구조 통일)
import { ProviderError, type AiChatMessage, type GeminiStreamResult } from "./gemini";

type AnthropicSseEvent = {
  type?: string;
  message?: { usage?: { input_tokens?: number } };
  delta?: { type?: string; text?: string; stop_reason?: string };
  usage?: { output_tokens?: number };
  error?: { message?: string };
};

export async function streamAnthropicChat(args: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: AiChatMessage[];
  onDelta: (text: string) => void;
}): Promise<GeminiStreamResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": args.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: args.model,
      max_tokens: 8192,
      stream: true,
      system: args.systemPrompt,
      messages: args.messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok || !res.body) {
    const retryAfter = Number(res.headers.get("retry-after")) || null;
    const body = await res.text().catch(() => "");
    console.error("anthropic upstream error", res.status, body.slice(0, 300));
    throw new ProviderError(`AI 제공사 오류 (${res.status})`, res.status, retryAfter);
  }

  const result: GeminiStreamResult = { inputTokens: 0, outputTokens: 0, finishReason: null };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consumeLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload) return;
    let event: AnthropicSseEvent;
    try {
      event = JSON.parse(payload) as AnthropicSseEvent;
    } catch {
      return; // 불완전 청크는 무시
    }
    switch (event.type) {
      case "message_start":
        result.inputTokens = event.message?.usage?.input_tokens ?? result.inputTokens;
        break;
      case "content_block_delta":
        if (event.delta?.type === "text_delta" && event.delta.text) {
          args.onDelta(event.delta.text);
        }
        break;
      case "message_delta":
        result.outputTokens = event.usage?.output_tokens ?? result.outputTokens;
        if (event.delta?.stop_reason) result.finishReason = event.delta.stop_reason;
        break;
      case "error":
        throw new ProviderError(event.error?.message ?? "Anthropic 스트림 오류", 502, null);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      consumeLine(buffer.slice(0, idx).trimEnd());
      buffer = buffer.slice(idx + 1);
    }
  }
  consumeLine(buffer.trimEnd());
  return result;
}
