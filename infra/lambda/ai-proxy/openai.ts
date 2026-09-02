// OpenRouter Chat Completions(SSE 스트리밍) 호출 — OpenAI 호환 wire format.
// 파일명은 기존 import 경로 호환을 위해 유지한다.
import { ProviderError, type AiStreamResult } from "./provider";
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
  error?: { message?: string; code?: number | string };
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

export async function streamOpenRouterChat(args: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: AiWireMessage[];
  enableTools?: boolean;
  /** 클라이언트 끊김 시 upstream 도 중단해 토큰 소모를 멈춘다 */
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  onToolCall?: (call: AiToolCall) => void;
}): Promise<AiStreamResult> {
  const body: Record<string, unknown> = {
    model: args.model,
    stream: true,
    stream_options: { include_usage: true },
    // 취합·표 생성 등 긴 출력 대응. 화이트리스트 전 모델이 허용하는 최댓값이며
    // 상한은 Claude Haiku 4.5(64,000)가 결정한다. Gemini 3.x 는 65,536 까지
    // 가능하지만 모델별 분기 대신 공통 상한을 쓴다.
    max_tokens: 64_000,
    messages: [
      { role: "system", content: args.systemPrompt },
      ...toOpenAiMessages(args.messages),
    ],
  };
  if (args.enableTools) {
    body.tools = openaiTools();
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${args.apiKey}`,
      "HTTP-Referer": "https://quick-note-khaki.vercel.app",
      "X-OpenRouter-Title": "QuickNote",
    },
    body: JSON.stringify(body),
    signal: args.signal,
  });

  if (!res.ok || !res.body) {
    const retryAfter = Number(res.headers.get("retry-after")) || null;
    const errBody = await res.text().catch(() => "");
    console.error("openrouter upstream error", res.status, errBody.slice(0, 300));
    throw new ProviderError(`AI 제공사 오류 (${res.status})`, res.status, retryAfter);
  }

  const result: AiStreamResult = {
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

  const consumeLine = (line: string): boolean => {
    if (!line.startsWith("data:")) return false;
    const payload = line.slice(5).trim();
    if (!payload) return false;
    if (payload === "[DONE]") return true;
    let chunk: OpenAiSseChunk;
    try {
      chunk = JSON.parse(payload) as OpenAiSseChunk;
    } catch {
      return false;
    }
    if (chunk.error) {
      const status =
        typeof chunk.error.code === "number" && chunk.error.code >= 400
          ? chunk.error.code
          : 502;
      throw new ProviderError(chunk.error.message || "OpenRouter 스트리밍 오류", status, null);
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
    return false;
  };

  let streamDone = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        streamDone = consumeLine(buffer.slice(0, idx).trimEnd());
        buffer = buffer.slice(idx + 1);
        if (streamDone) break;
      }
      if (streamDone) break;
    }
  } finally {
    // 오류·중단 경로에서도 upstream 연결 해제(토큰 소모 중지)
    reader.cancel().catch(() => {});
  }
  if (!streamDone) consumeLine(buffer.trimEnd());
  flushTools();
  if (result.toolCalls.length > 0 && !result.finishReason) {
    result.finishReason = "tool_calls";
  }
  return result;
}
