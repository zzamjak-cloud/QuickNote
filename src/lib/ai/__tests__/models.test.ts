import { describe, expect, it } from "vitest";
import {
  AI_DEFAULT_MODEL_BY_PROVIDER,
  AI_MODELS_BY_PROVIDER,
  availableModels,
  providerForModel,
} from "../models";

describe("Gemini 모델 계약", () => {
  it("OpenRouter Gemini 3.6 Flash slug를 권장 기본 모델로 사용한다", () => {
    expect(AI_DEFAULT_MODEL_BY_PROVIDER.gemini).toBe("google/gemini-3.6-flash");
    expect(AI_MODELS_BY_PROVIDER.gemini.map((model) => model.id)).toEqual([
      "google/gemini-3.6-flash",
      "google/gemini-3.5-flash",
      "google/gemini-3.5-flash-lite",
      "google/gemini-3.1-pro-preview",
    ]);
  });

  it("직접 제공사 ID는 거부하고 OpenRouter 키로 전체 모델을 노출한다", () => {
    expect(providerForModel("gemini-2.5-flash")).toBeNull();
    expect(providerForModel("gemini-2.5-pro")).toBeNull();
    expect(providerForModel("google/gemini-3.6-flash")).toBe("gemini");
    expect(providerForModel("anthropic/claude-haiku-4.5")).toBe("anthropic");
    expect(providerForModel("openai/gpt-5-mini")).toBe("openai");
    expect(availableModels(["gemini"])).toEqual([]);
    expect(availableModels(["openrouter"]).map((model) => model.id)).toEqual([
      ...AI_MODELS_BY_PROVIDER.gemini.map((model) => model.id),
      ...AI_MODELS_BY_PROVIDER.anthropic.map((model) => model.id),
      ...AI_MODELS_BY_PROVIDER.openai.map((model) => model.id),
    ]);
  });
});
