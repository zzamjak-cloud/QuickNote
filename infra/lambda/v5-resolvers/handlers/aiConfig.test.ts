import { describe, expect, it } from "vitest";
import {
  AI_DEFAULT_MODEL_BY_PROVIDER,
  AI_MODELS_BY_PROVIDER,
  aiConfigToGql,
  providerForModel,
} from "./aiConfig";

describe("AI 서버 모델 계약", () => {
  it("Gemini 3.6 Flash를 허용하고 기본값으로 사용한다", () => {
    expect(AI_MODELS_BY_PROVIDER.gemini).toEqual([
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-pro-preview",
    ]);
    expect(AI_DEFAULT_MODEL_BY_PROVIDER.gemini).toBe("gemini-3.6-flash");
    expect(providerForModel("gemini-3.6-flash")).toBe("gemini");
    expect(providerForModel("gemini-2.5-pro")).toBeNull();
    expect(providerForModel("gemini-3.1-pro-preview")).toBe("gemini");
  });

  it("저장된 이전 Flash 기본값을 3.6으로 폴백한다", () => {
    const config = aiConfigToGql("workspace-1", {
      workspaceId: "workspace-1",
      enabled: true,
      defaultModel: "gemini-2.5-flash",
      keys: { gemini: { enc: "encrypted", last4: "1234" } },
    });

    expect(providerForModel("gemini-2.5-flash")).toBeNull();
    expect(config.defaultModel).toBe("gemini-3.6-flash");
  });
});
