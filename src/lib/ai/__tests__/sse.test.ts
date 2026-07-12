import { describe, expect, it } from "vitest";
import { createSseJsonDecoder } from "../sse";

describe("createSseJsonDecoder", () => {
  it("완성된 data 라인을 이벤트로 파싱한다", () => {
    const events: unknown[] = [];
    const d = createSseJsonDecoder((e) => events.push(e));
    d.push('data: {"delta":"안녕"}\n\ndata: {"done":true}\n\n');
    d.flush();
    expect(events).toEqual([{ delta: "안녕" }, { done: true }]);
  });

  it("청크 경계에서 잘린 JSON 을 다음 push 에서 이어 파싱한다", () => {
    const events: unknown[] = [];
    const d = createSseJsonDecoder((e) => events.push(e));
    d.push('data: {"del');
    d.push('ta":"이어짐"}\n');
    d.flush();
    expect(events).toEqual([{ delta: "이어짐" }]);
  });

  it("개행 없이 끝난 마지막 라인은 flush 에서 처리한다", () => {
    const events: unknown[] = [];
    const d = createSseJsonDecoder((e) => events.push(e));
    d.push('data: {"done":true}');
    expect(events).toEqual([]);
    d.flush();
    expect(events).toEqual([{ done: true }]);
  });

  it("data 가 아닌 라인·[DONE]·깨진 JSON 은 무시한다", () => {
    const events: unknown[] = [];
    const d = createSseJsonDecoder((e) => events.push(e));
    d.push(': comment\nevent: ping\ndata: [DONE]\ndata: {broken\ndata: {"ok":1}\n');
    d.flush();
    expect(events).toEqual([{ ok: 1 }]);
  });
});
