import { afterEach, describe, expect, it, vi } from "vitest";
import { streamOpenRouterChat } from "./openai";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenRouter 스트리밍 요청", () => {
  it("통합 엔드포인트·귀속 헤더·모델 slug와 도구 호출을 보존한다", async () => {
    let requestUrl = "";
    let authorization = "";
    let httpReferer = "";
    let openRouterTitle = "";
    let requestBodyJson = "";
    const chunks = [
      ": OPENROUTER PROCESSING",
      'data: {"choices":[{"delta":{"content":"안녕"}}]}',
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call-1",
                  function: {
                    name: "get_page_content",
                    arguments: JSON.stringify({ pageId: "page-1" }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      })}`,
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":12,"completion_tokens":4}}',
      "data: [DONE]",
      "",
    ].join("\n");

    vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
      requestUrl = String(input);
      const headers = new Headers(init?.headers);
      authorization = headers.get("authorization") ?? "";
      httpReferer = headers.get("HTTP-Referer") ?? "";
      openRouterTitle = headers.get("X-OpenRouter-Title") ?? "";
      requestBodyJson = String(init?.body);
      return new Response(chunks, { status: 200 });
    });

    const deltas: string[] = [];
    const toolCalls: unknown[] = [];
    const result = await streamOpenRouterChat({
      apiKey: "test-key",
      model: "google/gemini-3.6-flash",
      systemPrompt: "테스트 지침",
      messages: [{ role: "user", content: "페이지를 읽어줘" }],
      enableTools: true,
      onDelta: (text) => deltas.push(text),
      onToolCall: (call) => toolCalls.push(call),
    });

    expect(requestUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(authorization).toBe("Bearer test-key");
    expect(httpReferer).toBe("https://quick-note-khaki.vercel.app");
    expect(openRouterTitle).toBe("QuickNote");
    const requestBody = JSON.parse(requestBodyJson) as Record<string, unknown>;
    expect(requestBody).toMatchObject({
      model: "google/gemini-3.6-flash",
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 32_768,
    });
    expect(Array.isArray(requestBody.tools)).toBe(true);
    expect(deltas).toEqual(["안녕"]);
    expect(toolCalls).toEqual([
      { id: "call-1", name: "get_page_content", args: { pageId: "page-1" } },
    ]);
    expect(result).toMatchObject({
      finishReason: "tool_calls",
      inputTokens: 12,
      outputTokens: 4,
    });
  });

  it("HTTP 200 스트림 중간의 OpenRouter 오류 이벤트를 실패로 전달한다", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          'data: {"error":{"message":"Provider unavailable","code":503}}\n\n',
          { status: 200 },
        ),
    );

    await expect(
      streamOpenRouterChat({
        apiKey: "test-key",
        model: "openai/gpt-5-mini",
        systemPrompt: "테스트 지침",
        messages: [{ role: "user", content: "질문" }],
        onDelta: () => {},
      }),
    ).rejects.toMatchObject({ status: 503, message: "Provider unavailable" });
  });

  it("[DONE] 뒤에 연결이 열려 있어도 즉시 종료하고 upstream을 취소한다", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"완료"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
          ),
        );
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal("fetch", async () => new Response(body, { status: 200 }));

    const deltas: string[] = [];
    const result = await streamOpenRouterChat({
      apiKey: "test-key",
      model: "openai/gpt-5-mini",
      systemPrompt: "테스트 지침",
      messages: [{ role: "user", content: "질문" }],
      onDelta: (text) => deltas.push(text),
    });

    expect(deltas).toEqual(["완료"]);
    expect(result.finishReason).toBe("stop");
    expect(cancelled).toBe(true);
  });
});
