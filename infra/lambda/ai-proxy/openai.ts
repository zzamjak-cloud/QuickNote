// OpenAI Chat Completions(SSE 스트리밍) 호출 — gemini.ts 와 동일한 인터페이스.
// 시스템 프롬프트(지침+컨텍스트)를 첫 system 메시지에 고정 배치 → OpenAI 자동 prompt caching 적중.
import { ProviderError, type GeminiStreamResult } from "./gemini";
import { openaiTools, type AiToolCall, type AiWireMessage } from "./tools";

type OpenAiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type OpenAiMessage =
  | { role: "system" | "assistant"; content: string }
  | { role: "user"; content: string | OpenAiContentPart[] }
  | {
      role: "assistant";
      content: null;
      tool_calls: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

type OpenAiSseChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
};

function toOpenAiMessages(messages: AiWireMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      if (m.images && m.images.length > 0) {
        // 이미지 첨부는 텍스트 앞에 배치 (타 어댑터와 동일 규약)
        out.push({
          role: "user",
          content: [
            ...m.images.map((img) => ({
              type: "image_url" as const,
              image_url: { url: `data:${img.mimeType};base64,${img.dataBase64}` },
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
        content: null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        })),
      });
    } else if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    }
  }
  return out;
}

export async function streamOpenAiChat(args: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: AiWireMessage[];
  enableTools?: boolean;
  /** 클라이언트 끊김 시 upstream 도 중단해 토큰 소모를 멈춘다 */
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  onToolCall?: (call: AiToolCall) => void;
}): Promise<GeminiStreamResult> {
  const body: Record<string, unknown> = {
    model: args.model,
    stream: true,
    stream_options: { include_usage: true },
    // GPT-5 계열은 max_tokens 대신 max_completion_tokens 사용
    max_completion_tokens: 32_768,
    messages: [
      { role: "system", content: args.systemPrompt },
      ...toOpenAiMessages(args.messages),
    ],
  };
  if (args.enableTools) {
    body.tools = openaiTools();
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: args.signal,
  });

  if (!res.ok || !res.body) {
    const retryAfter = Number(res.headers.get("retry-after")) || null;
    const errBody = await res.text().catch(() => "");
    console.error("openai upstream error", res.status, errBody.slice(0, 300));
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

  // index → 조립 중 tool_call (arguments 는 청크로 나뉘어 옴)
  const pending = new Map<number, { id: string; name: string; args: string }>();

  const flushTools = () => {
    for (const [, p] of [...pending.entries()].sort((a, b) => a[0] - b[0])) {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = p.args ? (JSON.parse(p.args) as Record<string, unknown>) : {};
      } catch {
        parsedArgs = { _raw: p.args };
      }
      const call: AiToolCall = { id: p.id, name: p.name, args: parsedArgs };
      result.toolCalls.push(call);
      args.onToolCall?.(call);
    }
    pending.clear();
  };

  const consumeLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let chunk: OpenAiSseChunk;
    try {
      chunk = JSON.parse(payload) as OpenAiSseChunk;
    } catch {
      return;
    }
    const choice = chunk.choices?.[0];
    if (choice?.delta?.content) args.onDelta(choice.delta.content);
    for (const tc of choice?.delta?.tool_calls ?? []) {
      const index = tc.index ?? 0;
      const p = pending.get(index) ?? { id: "", name: "", args: "" };
      if (tc.id) p.id = tc.id;
      if (tc.function?.name) p.name += tc.function.name;
      if (tc.function?.arguments) p.args += tc.function.arguments;
      pending.set(index, p);
    }
    if (choice?.finish_reason) result.finishReason = choice.finish_reason;
    if (chunk.usage) {
      result.inputTokens = chunk.usage.prompt_tokens ?? result.inputTokens;
      result.outputTokens = chunk.usage.completion_tokens ?? result.outputTokens;
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
  flushTools();
  if (result.toolCalls.length > 0 && !result.finishReason) {
    result.finishReason = "tool_calls";
  }
  return result;
}
