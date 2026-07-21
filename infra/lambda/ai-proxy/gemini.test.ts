import { afterEach, describe, expect, it, vi } from "vitest";
import { streamGeminiChat } from "./gemini";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Gemini 3.6 Flash 요청", () => {
  it("폐기된 샘플링 값을 빼고 함수 호출 메타데이터를 왕복 보존한다", async () => {
    const captured: {
      requestUrl: string;
      requestBody: Record<string, unknown> | null;
    } = { requestUrl: "", requestBody: null };
    const upstreamChunk = {
      candidates: [
        {
          content: {
            parts: [
              { text: "도구를 확인할게요." },
              { thought: true, thoughtSignature: "text-signature" },
              {
                functionCall: {
                  id: "call-next",
                  name: "get_page_content",
                  args: { pageId: "page-2" },
                },
                thoughtSignature: "signature-next",
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 },
    };

    const previousCallId = `call-prev-${"x".repeat(160)}`;
    vi.stubGlobal("fetch", async (input: unknown, init?: { body?: unknown }) => {
      captured.requestUrl = String(input);
      captured.requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(`data: ${JSON.stringify(upstreamChunk)}\n\n`, { status: 200 });
    });

    const result = await streamGeminiChat({
      apiKey: "test-key",
      model: "gemini-3.6-flash",
      systemPrompt: "테스트 지침",
      messages: [
        { role: "user", content: "행을 찾아줘" },
        {
          role: "assistant_tools",
          toolCalls: [
            {
              id: previousCallId,
              name: "list_database_rows",
              args: { databaseId: "db-1" },
              thoughtSignature: "signature-prev",
            },
          ],
        },
        {
          role: "tool",
          toolCallId: previousCallId,
          name: "list_database_rows",
          content: "결과",
        },
      ],
      enableTools: true,
      onDelta: () => {},
    });

    expect(captured.requestUrl).toContain("models/gemini-3.6-flash:streamGenerateContent");
    expect(captured.requestBody).not.toBeNull();
    expect(captured.requestBody?.generationConfig).toEqual({ maxOutputTokens: 32_768 });

    const contents = captured.requestBody?.contents as Array<{
      parts: Array<{
        thoughtSignature?: string;
        functionCall?: { id?: string };
        functionResponse?: { id?: string; name?: string };
      }>;
    }>;
    expect(contents[1]?.parts[0]).toMatchObject({
      thoughtSignature: "signature-prev",
      functionCall: { id: previousCallId },
    });
    expect(contents[2]?.parts[0]?.functionResponse).toMatchObject({
      id: previousCallId,
      name: "list_database_rows",
    });
    expect(result.toolCalls).toEqual([
      {
        id: "call-next",
        name: "get_page_content",
        args: { pageId: "page-2" },
        thoughtSignature: "signature-next",
      },
    ]);
    expect(result.geminiParts).toEqual([
      { text: "도구를 확인할게요." },
      { thought: true, thoughtSignature: "text-signature" },
    ]);
  });

  it("마지막 model prefill을 upstream 호출 전에 거부한다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      streamGeminiChat({
        apiKey: "test-key",
        model: "gemini-3.6-flash",
        systemPrompt: "테스트 지침",
        messages: [{ role: "assistant", content: "미리 채운 답변" }],
        onDelta: () => {},
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Gemini 3.1 Pro Preview에는 기본 temperature를 사용한다", async () => {
    let generationConfig: unknown;
    vi.stubGlobal("fetch", async (_input: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      generationConfig = body.generationConfig;
      return new Response('data: {"candidates":[{"finishReason":"STOP"}]}\n\n', {
        status: 200,
      });
    });

    await streamGeminiChat({
      apiKey: "test-key",
      model: "gemini-3.1-pro-preview",
      systemPrompt: "테스트 지침",
      messages: [{ role: "user", content: "질문" }],
      onDelta: () => {},
    });

    expect(generationConfig).toEqual({ maxOutputTokens: 32_768 });
  });

  it("Gemini 3.5 Flash-Lite에도 폐기된 샘플링 값을 보내지 않는다", async () => {
    let generationConfig: unknown;
    vi.stubGlobal("fetch", async (_input: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      generationConfig = body.generationConfig;
      return new Response('data: {"candidates":[{"finishReason":"STOP"}]}\n\n', {
        status: 200,
      });
    });

    await streamGeminiChat({
      apiKey: "test-key",
      model: "gemini-3.5-flash-lite",
      systemPrompt: "테스트 지침",
      messages: [{ role: "user", content: "질문" }],
      onDelta: () => {},
    });

    expect(generationConfig).toEqual({ maxOutputTokens: 32_768 });
  });
});
