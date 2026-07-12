// Gemini streamGenerateContent(SSE) 호출 — 텍스트 델타를 콜백으로 흘리고 토큰 사용량을 반환.

export type AiChatMessage = { role: "user" | "assistant"; content: string };

export type GeminiStreamResult = {
  inputTokens: number;
  outputTokens: number;
  finishReason: string | null;
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

type GeminiChunk = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

export async function streamGeminiChat(args: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: AiChatMessage[];
  onDelta: (text: string) => void;
}): Promise<GeminiStreamResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:streamGenerateContent?alt=sse`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": args.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: args.systemPrompt }] },
      contents: args.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
    }),
  });

  if (!res.ok || !res.body) {
    const retryAfter = Number(res.headers.get("retry-after")) || null;
    const body = await res.text().catch(() => "");
    // 키·요청 정보가 로그에 남지 않도록 상태와 앞부분만 기록
    console.error("gemini upstream error", res.status, body.slice(0, 300));
    throw new ProviderError(`AI 제공사 오류 (${res.status})`, res.status, retryAfter);
  }

  const result: GeminiStreamResult = { inputTokens: 0, outputTokens: 0, finishReason: null };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

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
    const text = cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (text) args.onDelta(text);
    if (cand?.finishReason) result.finishReason = cand.finishReason;
    if (chunk.usageMetadata) {
      result.inputTokens = chunk.usageMetadata.promptTokenCount ?? result.inputTokens;
      result.outputTokens = chunk.usageMetadata.candidatesTokenCount ?? result.outputTokens;
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
