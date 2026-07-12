// Anthropic Messages API(SSE 스트리밍) 호출 — gemini.ts 와 동일한 인터페이스.
// system 은 지침 + 컨텍스트 블록으로 분리하고, 컨텍스트에 ephemeral prompt cache 를 건다.
import { ProviderError, type GeminiStreamResult } from "./gemini";
import {
  anthropicTools,
  type AiToolCall,
  type AiWireMessage,
} from "./tools";

type AnthropicSseEvent = {
  type?: string;
  index?: number;
  content_block?: {
    type?: string;
    id?: string;
    name?: string;
    text?: string;
  };
  message?: { usage?: { input_tokens?: number } };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: { output_tokens?: number };
  error?: { message?: string };
};

type AnthropicContent =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

function toAnthropicMessages(
  messages: AiWireMessage[],
): Array<{ role: "user" | "assistant"; content: string | AnthropicContent[] }> {
  const out: Array<{ role: "user" | "assistant"; content: string | AnthropicContent[] }> = [];
  for (const m of messages) {
    if (m.role === "user") {
      if (m.images && m.images.length > 0) {
        // 이미지 첨부는 텍스트 앞에 배치 (제공사 권장 순서)
        out.push({
          role: "user",
          content: [
            ...m.images.map((img) => ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: img.mimeType,
                data: img.dataBase64,
              },
            })),
            { type: "text" as const, text: m.content },
          ],
        });
        continue;
      }
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      out.push({ role: "assistant", content: m.content });
    } else if (m.role === "assistant_tools") {
      out.push({
        role: "assistant",
        content: m.toolCalls.map((tc) => ({
          type: "tool_use" as const,
          id: tc.id,
          name: tc.name,
          input: tc.args,
        })),
      });
    } else if (m.role === "tool") {
      const block: AnthropicContent = {
        type: "tool_result",
        tool_use_id: m.toolCallId,
        content: m.content,
      };
      const last = out[out.length - 1];
      if (last?.role === "user" && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    }
  }
  return out;
}

export async function streamAnthropicChat(args: {
  apiKey: string;
  model: string;
  /** 고정 지침 — 캐시 프리픽스 앞부분. */
  instructions: string;
  /** <context>… 블록. 있으면 ephemeral 캐시 대상. */
  contextBlock?: string | null;
  /** @deprecated instructions+contextBlock 사용 권장 */
  systemPrompt?: string;
  messages: AiWireMessage[];
  enableTools?: boolean;
  /** 클라이언트 끊김 시 upstream 도 중단해 토큰 소모를 멈춘다 */
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  onToolCall?: (call: AiToolCall) => void;
}): Promise<GeminiStreamResult> {
  const instructions = args.instructions ?? args.systemPrompt ?? "";
  const contextBlock = args.contextBlock?.trim() || null;

  // 컨텍스트를 system 배열 두 번째 블록에 두고 cache_control — 멀티턴에서 반복 비용 절감
  const system = contextBlock
    ? [
        { type: "text", text: instructions },
        {
          type: "text",
          text: contextBlock,
          cache_control: { type: "ephemeral" },
        },
      ]
    : instructions;

  const body: Record<string, unknown> = {
    model: args.model,
    max_tokens: 8192,
    stream: true,
    system,
    messages: toAnthropicMessages(args.messages),
  };
  if (args.enableTools) {
    body.tools = anthropicTools();
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": args.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: args.signal,
  });

  if (!res.ok || !res.body) {
    const retryAfter = Number(res.headers.get("retry-after")) || null;
    const errBody = await res.text().catch(() => "");
    console.error("anthropic upstream error", res.status, errBody.slice(0, 300));
    throw new ProviderError(`AI 제공사 오류 (${res.status})`, res.status, retryAfter);
  }

  const result: GeminiStreamResult = {
    inputTokens: 0,
    outputTokens: 0,
    finishReason: null,
    toolCalls: [],
  };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // index → 조립 중 tool_use
  const pending = new Map<number, { id: string; name: string; json: string }>();

  const flushTool = (index: number) => {
    const p = pending.get(index);
    if (!p) return;
    pending.delete(index);
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = p.json ? (JSON.parse(p.json) as Record<string, unknown>) : {};
    } catch {
      parsedArgs = { _raw: p.json };
    }
    const call: AiToolCall = { id: p.id, name: p.name, args: parsedArgs };
    result.toolCalls.push(call);
    args.onToolCall?.(call);
  };

  const consumeLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload) return;
    let event: AnthropicSseEvent;
    try {
      event = JSON.parse(payload) as AnthropicSseEvent;
    } catch {
      return;
    }
    switch (event.type) {
      case "message_start":
        result.inputTokens = event.message?.usage?.input_tokens ?? result.inputTokens;
        break;
      case "content_block_start": {
        const block = event.content_block;
        if (block?.type === "tool_use" && block.id && block.name) {
          pending.set(event.index ?? 0, { id: block.id, name: block.name, json: "" });
        }
        break;
      }
      case "content_block_delta":
        if (event.delta?.type === "text_delta" && event.delta.text) {
          args.onDelta(event.delta.text);
        } else if (event.delta?.type === "input_json_delta") {
          const p = pending.get(event.index ?? 0);
          if (p) p.json += event.delta.partial_json ?? "";
        }
        break;
      case "content_block_stop":
        flushTool(event.index ?? 0);
        break;
      case "message_delta":
        result.outputTokens = event.usage?.output_tokens ?? result.outputTokens;
        if (event.delta?.stop_reason) result.finishReason = event.delta.stop_reason;
        break;
      case "error":
        throw new ProviderError(event.error?.message ?? "Anthropic 스트림 오류", 502, null);
    }
  };

  try {
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
  } finally {
    // 오류·중단 경로에서도 upstream 연결 해제(토큰 소모 중지)
    reader.cancel().catch(() => {});
  }
  consumeLine(buffer.trimEnd());
  for (const index of [...pending.keys()]) flushTool(index);
  if (result.toolCalls.length > 0 && result.finishReason === "tool_use") {
    // 이미 tool_use
  } else if (result.toolCalls.length > 0) {
    result.finishReason = "tool_use";
  }
  return result;
}
