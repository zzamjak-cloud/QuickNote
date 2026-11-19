import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { echoableContent, streamAnthropicChat } from "./anthropic";
import { ProviderError } from "./provider";
import type { AiWireMessage } from "./tools";

// 공용 vitest 설정이 jsdom 이라 SDK 가 브라우저로 오인한다 — Lambda(Node)와 같게 navigator 를 숨긴다.
beforeEach(() => {
  vi.stubGlobal("navigator", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sse(events: Array<Record<string, unknown>>): string {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

const STREAM = sse([
  {
    type: "message_start",
    message: {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: 1,
        cache_creation_input_tokens: 5,
        cache_read_input_tokens: 3,
      },
    },
  },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "안녕" } },
  { type: "content_block_stop", index: 0 },
  {
    type: "content_block_start",
    index: 1,
    content_block: { type: "tool_use", id: "toolu_1", name: "get_page_content", input: {} },
  },
  {
    type: "content_block_delta",
    index: 1,
    delta: { type: "input_json_delta", partial_json: '{"pageId":"page-1"}' },
  },
  { type: "content_block_stop", index: 1 },
  {
    type: "message_delta",
    delta: { stop_reason: "tool_use", stop_sequence: null },
    usage: { output_tokens: 7 },
  },
  { type: "message_stop" },
]);

describe("Anthropic 직접 스트리밍 요청", () => {
  it("slug 를 네이티브 ID 로 바꾸고 도구 왕복·캐시·사용량을 처리한다", async () => {
    let requestUrl = "";
    let apiKeyHeader = "";
    let authorizationHeader: string | null = null;
    let body: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
      requestUrl = String(input instanceof Request ? input.url : input);
      const headers = new Headers(init?.headers);
      authorizationHeader = headers.get("authorization");
      apiKeyHeader = headers.get("x-api-key") ?? "";
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(STREAM, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const deltas: string[] = [];
    const toolCalls: unknown[] = [];
    const result = await streamAnthropicChat({
      apiKey: "sk-ant-test",
      model: "anthropic/claude-sonnet-5",
      instructions: "테스트 지침",
      contextBlock: "<context>본문</context>",
      messages: [
        { role: "assistant", content: "잘린 히스토리의 이전 답변" },
        { role: "user", content: "페이지를 읽어줘" },
        { role: "assistant", content: "" },
        {
          role: "assistant_tools",
          toolCalls: [
            { id: "a", name: "get_row", args: { rowId: "r1" } },
            { id: "b", name: "get_row", args: { rowId: "r2" } },
          ],
        },
        { role: "tool", toolCallId: "a", name: "get_row", content: "행1" },
        { role: "tool", toolCallId: "b", name: "get_row", content: "행2" },
      ],
      enableTools: true,
      onDelta: (text) => deltas.push(text),
      onToolCall: (call) => toolCalls.push(call),
    });

    expect(requestUrl).toBe("https://api.anthropic.com/v1/messages");
    // SDK 1.x 는 API 키를 Bearer 로 보낸다
    expect(authorizationHeader).toBe("Bearer sk-ant-test");
    expect(apiKeyHeader).toBe("");
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.stream).toBe(true);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(Array.isArray(body.tools)).toBe(true);
    const system = body.system as Array<Record<string, unknown>>;
    expect(system[1]).toMatchObject({ cache_control: { type: "ephemeral" } });
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    // 선행 assistant·빈 assistant 는 제거, 연속 도구 결과는 한 user 메시지로 병합
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(messages[2]!.content).toHaveLength(2);

    expect(deltas).toEqual(["안녕"]);
    expect(toolCalls).toEqual([
      { id: "toolu_1", name: "get_page_content", args: { pageId: "page-1" } },
    ]);
    expect(result).toMatchObject({
      inputTokens: 18,
      outputTokens: 7,
      finishReason: "tool_use",
      toolCalls,
    });
    expect(result.anthropicContent?.map((b) => b.type)).toEqual(["text", "tool_use"]);
  });

  it("Haiku 4.5 는 thinking 필드를 보내지 않는다", async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(STREAM, { status: 200 });
    });
    await streamAnthropicChat({
      apiKey: "sk-ant-test",
      model: "anthropic/claude-haiku-4.5",
      instructions: "지침",
      messages: [{ role: "user", content: "hi" }],
      onDelta: () => {},
    });
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.thinking).toBeUndefined();
    expect(body.tools).toBeUndefined();
  });

  it("업스트림 오류를 상태코드·retry-after 가 담긴 ProviderError 로 바꾼다", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow" } }),
          { status: 429, headers: { "retry-after": "12", "content-type": "application/json" } },
        ),
    );
    const err = await streamAnthropicChat({
      apiKey: "sk-ant-test",
      model: "anthropic/claude-haiku-4.5",
      instructions: "지침",
      messages: [{ role: "user", content: "hi" }],
      onDelta: () => {},
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).status).toBe(429);
    expect((err as ProviderError).retryAfterSec).toBe(12);
  });

  it("Opus 5.5 는 adaptive·effort·fallback 으로 보내고, 도구 턴 원문을 다음 라운드에 그대로 되돌린다", async () => {
    const round1Stream = sse([
      {
        type: "message_start",
        message: {
          id: "msg_r1",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 20, output_tokens: 1 },
        },
      },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-1" } },
      { type: "content_block_stop", index: 0 },
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "toolu_9", name: "get_row", input: {} },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"rowId":"r1"}' },
      },
      { type: "content_block_stop", index: 1 },
      { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 9 } },
      { type: "message_stop" },
    ]);
    const bodies: Array<Record<string, unknown>> = [];
    const betaHeaders: Array<string | null> = [];
    vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      betaHeaders.push(new Headers(init?.headers).get("anthropic-beta"));
      return new Response(bodies.length === 1 ? round1Stream : STREAM, { status: 200 });
    });

    const common = {
      apiKey: "sk-ant-test",
      model: "anthropic/claude-opus-5.5",
      instructions: "지침",
      contextBlock: "<context>본문</context>",
      enableTools: true,
      onDelta: () => {},
    };
    const history: AiWireMessage[] = [
      { role: "user", content: "이전 질문" },
      { role: "assistant", content: "이전 답변" },
      { role: "user", content: "행을 찾아줘" },
    ];
    const r1 = await streamAnthropicChat({ ...common, messages: history });

    expect(bodies[0]!.model).toBe("claude-opus-5-5");
    expect(bodies[0]!.thinking).toEqual({
      type: "adaptive",
      block_binding: { prefix_mismatch_behavior: "drop_block" },
    });
    expect(bodies[0]!.output_config).toEqual({ effort: "medium" });
    expect(bodies[0]!.fallbacks).toBe("default");
    expect(betaHeaders[0]).toContain("server-side-fallback-2026-07-01");
    expect(betaHeaders[0]).toContain("thinking-binding-controls-2026-08-01");
    // thinking 을 끄지 않는 모델에는 thinking-off 보정 지침을 붙이지 않는다
    expect(JSON.stringify(bodies[0]!.system)).not.toContain("When you use a tool");
    expect(r1.toolCalls).toEqual([{ id: "toolu_9", name: "get_row", args: { rowId: "r1" } }]);
    expect(r1.anthropicContent?.map((b) => b.type)).toEqual(["thinking", "tool_use"]);
    expect(r1.anthropicContent?.[0]).toMatchObject({ signature: "sig-1" });

    // 2라운드 — 클라이언트가 원문을 그대로 되돌린 요청
    await streamAnthropicChat({
      ...common,
      messages: [
        ...history,
        { role: "assistant_tools", toolCalls: r1.toolCalls, anthropicContent: r1.anthropicContent },
        { role: "tool", toolCallId: "toolu_9", name: "get_row", content: "행1" },
      ],
    });
    // 대화 검증 대상(system·tools·이전 메시지)이 라운드 사이에 바뀌지 않아야 thinking 이 유효하다
    expect(bodies[1]!.system).toEqual(bodies[0]!.system);
    expect(bodies[1]!.tools).toEqual(bodies[0]!.tools);
    const m0 = bodies[0]!.messages as unknown[];
    const m1 = bodies[1]!.messages as Array<{ role: string; content: unknown }>;
    expect(m1.slice(0, m0.length)).toEqual(m0);
    expect(m1[m0.length]).toEqual({ role: "assistant", content: r1.anthropicContent });
  });

  it("대체 모델 전환 시 마지막 fallback 이전 내부 블록만 빼고 되돌린다", () => {
    const content = [
      { type: "thinking", thinking: "", signature: "a" },
      { type: "text", text: "부분", citations: null },
      { type: "tool_use", id: "x", name: "get_row", input: {} },
      { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-5" } },
      { type: "thinking", thinking: "", signature: "b" },
      { type: "tool_use", id: "y", name: "get_row", input: {} },
    ] as unknown as Parameters<typeof echoableContent>[0];
    expect(echoableContent(content).map((b) => b.type)).toEqual([
      "text",
      "fallback",
      "thinking",
      "tool_use",
    ]);
  });

  it("대체 모델까지 거절하면 ProviderError 로 알린다", async () => {
    const refusal = sse([
      {
        type: "message_start",
        message: {
          id: "msg_x",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      { type: "message_delta", delta: { stop_reason: "refusal", stop_sequence: null }, usage: { output_tokens: 0 } },
      { type: "message_stop" },
    ]);
    vi.stubGlobal("fetch", async () => new Response(refusal, { status: 200 }));
    const err = await streamAnthropicChat({
      apiKey: "sk-ant-test",
      model: "anthropic/claude-opus-5.5",
      instructions: "지침",
      messages: [{ role: "user", content: "hi" }],
      onDelta: () => {},
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).status).toBe(400);
  });
});
