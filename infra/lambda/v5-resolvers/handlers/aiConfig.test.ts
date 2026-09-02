import { describe, expect, it } from "vitest";
import {
  AI_DEFAULT_MODEL_BY_PROVIDER,
  AI_MODELS_BY_PROVIDER,
  aiConfigToGql,
  normalizeModelId,
  providerForModel,
} from "./aiConfig";

describe("AI 서버 모델 계약", () => {
  it("OpenRouter 모델 slug를 허용하고 Gemini 3.8 Flash를 기본값으로 사용한다", () => {
    expect(AI_MODELS_BY_PROVIDER.gemini).toEqual([
      "google/gemini-3.8-flash",
      "google/gemini-3.5-flash",
      "google/gemini-3.5-flash-lite",
      "google/gemini-3.1-pro-preview",
    ]);
    expect(AI_DEFAULT_MODEL_BY_PROVIDER.gemini).toBe("google/gemini-3.8-flash");
    expect(providerForModel("google/gemini-3.8-flash")).toBe("gemini");
    expect(providerForModel("gemini-2.5-pro")).toBeNull();
    expect(providerForModel("anthropic/claude-haiku-4.5")).toBe("anthropic");
    expect(providerForModel("openai/gpt-5.1")).toBe("openai");
  });

  it("저장된 직접 제공사 모델 ID를 OpenRouter slug로 승격한다", () => {
    const config = aiConfigToGql("workspace-1", {
      workspaceId: "workspace-1",
      enabled: true,
      defaultModel: "gemini-3.8-flash",
      keys: { openrouter: { enc: "encrypted", last4: "1234" } },
    });

    expect(normalizeModelId("gemini-3.8-flash")).toBe("google/gemini-3.8-flash");
    expect(config.defaultModel).toBe("google/gemini-3.8-flash");
    expect(config.provider).toBe("openrouter");
    expect(config.providers).toEqual([
      { provider: "openrouter", hasKey: true, apiKeyMasked: "****1234" },
    ]);
  });

  it("레거시 직접 제공사 키를 OpenRouter 키로 오인하지 않는다", () => {
    const config = aiConfigToGql("workspace-1", {
      workspaceId: "workspace-1",
      enabled: true,
      keys: { gemini: { enc: "encrypted", last4: "1234" } },
    });

    expect(config.hasKey).toBe(false);
    expect(config.providers[0]?.hasKey).toBe(false);
  });
});
