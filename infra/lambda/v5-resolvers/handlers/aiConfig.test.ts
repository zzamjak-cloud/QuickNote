import { describe, expect, it } from "vitest";
import {
  AI_DEFAULT_MODEL_BY_PROVIDER,
  allowedModelsForKeys,
  keyProviderForModel,
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
      { provider: "anthropic", hasKey: false, apiKeyMasked: null },
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

  it("Claude 키만 있으면 Claude 모델만 허용하고 기본값도 Claude 로 둔다", () => {
    const keys = { anthropic: { enc: "encrypted", last4: "abcd", v: 2 } };
    const config = aiConfigToGql("workspace-1", {
      workspaceId: "workspace-1",
      enabled: true,
      defaultModel: "google/gemini-3.8-flash",
      keys,
    });

    expect(config.hasKey).toBe(true);
    expect(config.provider).toBe("anthropic");
    expect(config.apiKeyMasked).toBe("****abcd");
    expect(config.defaultModel).toBe("anthropic/claude-haiku-4.5");
    expect(allowedModelsForKeys(keys)).toEqual(AI_MODELS_BY_PROVIDER.anthropic);
    expect(keyProviderForModel("anthropic/claude-sonnet-5", keys)).toBe("anthropic");
    expect(keyProviderForModel("google/gemini-3.8-flash", keys)).toBeNull();
  });

  it("두 키가 모두 있으면 Claude 모델만 직접 호출로 보낸다", () => {
    const keys = {
      openrouter: { enc: "encrypted-or", last4: "1234" },
      anthropic: { enc: "encrypted-ant", last4: "abcd", v: 2 },
    };
    expect(keyProviderForModel("anthropic/claude-haiku-4.5", keys)).toBe("anthropic");
    expect(keyProviderForModel("google/gemini-3.8-flash", keys)).toBe("openrouter");
    expect(keyProviderForModel("openai/gpt-5.1", keys)).toBe("openrouter");
    expect(keyProviderForModel("unknown/model", keys)).toBeNull();
  });

  it("직접 제공사 시절의 anthropic 슬롯(v 없음)은 되살리지 않는다", () => {
    const config = aiConfigToGql("workspace-1", {
      workspaceId: "workspace-1",
      enabled: true,
      keys: { anthropic: { enc: "old-encrypted", last4: "zzzz" } },
    });
    expect(config.hasKey).toBe(false);
    expect(config.providers.find((p) => p.provider === "anthropic")?.hasKey).toBe(false);
  });

  it("Opus 5.5·Sonnet 5.5 는 Claude 키가 있을 때만 허용·라우팅한다", () => {
    const openrouterOnly = { openrouter: { enc: "encrypted-or", last4: "1234" } };
    const both = { ...openrouterOnly, anthropic: { enc: "encrypted-ant", last4: "abcd", v: 2 } };
    expect(allowedModelsForKeys(openrouterOnly)).not.toContain("anthropic/claude-opus-5.5");
    expect(keyProviderForModel("anthropic/claude-opus-5.5", openrouterOnly)).toBeNull();
    expect(allowedModelsForKeys(both)).toContain("anthropic/claude-opus-5.5");
    expect(keyProviderForModel("anthropic/claude-sonnet-5.5", both)).toBe("anthropic");
  });
});
