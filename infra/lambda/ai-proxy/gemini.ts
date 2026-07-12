// Gemini streamGenerateContent(SSE) 호출 — 텍스트 델타를 콜백으로 흘리고 토큰 사용량을 반환.
// 규약: systemInstruction = 고정 지침(+컨텍스트 프리픽스), contents = 대화만.
// 컨텍스트를 user 메시지에 섞지 않는다 → Gemini implicit prompt caching 적중.
import {
  geminiFunctionDeclarations,
  type AiToolCall,
  type AiWireMessage,
} from "./tools";

export type AiChatMessage = { role: "user" | "assistant"; content: string };

export type GeminiStreamResult = {
  inputTokens: number;
  outputTokens: number;
  finishReason: string | null;
  toolCalls: AiToolCall[];
};

export class ProviderError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfterSec: number | null = null,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

type GeminiPart = {
  text?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> };
  functionResponse?: {
    name?: string;
    response?: Record<string, unknown>;
  };
};

type GeminiChunk = {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

function toGeminiContents(messages: AiWireMessage[]): Array<{
  role: string;
  parts: GeminiPart[];
}> {
  const contents: Array<{ role: string; parts: GeminiPart[] }> = [];
  for (const m of messages) {
    if (m.role === "user") {
      contents.push({ role: "user", parts: [{ text: m.content }] });
    } else if (m.role === "assistant") {
      contents.push({ role: "model", parts: [{ text: m.content }] });
    } else if (m.role === "assistant_tools") {
      contents.push({
        role: "model",
        parts: m.toolCalls.map((tc) => ({
          functionCall: { name: tc.name, args: tc.args },
        })),
      });
    } else if (m.role === "tool") {
      // 연속 tool 결과는 같은 user 턴으로 묶는다
      const part: GeminiPart = {
        functionResponse: {
          name: m.name,
          response: { result: m.content },
        },
      };
      const last = contents[contents.length - 1];
      if (last?.role === "user" && last.parts.some((p) => p.functionResponse)) {
        last.parts.push(part);
      } else {
        contents.push({ role: "user", parts: [part] });
      }
    }
  }
  return contents;
}

export async function streamGeminiChat(args: {
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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:streamGenerateContent?alt=sse`;
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: args.systemPrompt }] },
    contents: toGeminiContents(args.messages),
    generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
  };
  if (args.enableTools) {
    body.tools = [{ functionDeclarations: geminiFunctionDeclarations() }];
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": args.apiKey },
    body: JSON.stringify(body),
    signal: args.signal,
  });

  if (!res.ok || !res.body) {
    const retryAfter = Number(res.headers.get("retry-after")) || null;
    const bodyText = await res.text().catch(() => "");
    // 키·요청 정보가 로그에 남지 않도록 상태와 앞부분만 기록
    console.error("gemini upstream error", res.status, bodyText.slice(0, 300));
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
  let toolSeq = 0;

  const consumeLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let chunk: GeminiChunk;
    try {
      chunk = JSON.parse(payload) as GeminiChunk;
    } catch {
      return; // 불완전 청크는 무시(다음 버퍼에서 이어짐)
    }
    const cand = chunk.candidates?.[0];
    for (const part of cand?.content?.parts ?? []) {
      if (part.text) args.onDelta(part.text);
      if (part.functionCall?.name) {
        toolSeq += 1;
        const call: AiToolCall = {
          id: `gemini-tool-${toolSeq}`,
          name: part.functionCall.name,
          args: part.functionCall.args ?? {},
        };
        result.toolCalls.push(call);
        args.onToolCall?.(call);
      }
    }
    if (cand?.finishReason) result.finishReason = cand.finishReason;
    if (chunk.usageMetadata) {
      result.inputTokens = chunk.usageMetadata.promptTokenCount ?? result.inputTokens;
      result.outputTokens = chunk.usageMetadata.candidatesTokenCount ?? result.outputTokens;
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
  if (result.toolCalls.length > 0 && !result.finishReason) {
    result.finishReason = "tool_use";
  }
  return result;
}
