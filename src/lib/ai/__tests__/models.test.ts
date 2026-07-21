import { describe, expect, it } from "vitest";
import {
  AI_DEFAULT_MODEL_BY_PROVIDER,
  AI_MODELS_BY_PROVIDER,
  availableModels,
  providerForModel,
} from "../models";

describe("Gemini 모델 계약", () => {
  it("Gemini 3.6 Flash를 권장 기본 모델로 사용한다", () => {
    expect(AI_DEFAULT_MODEL_BY_PROVIDER.gemini).toBe("gemini-3.6-flash");
    expect(AI_MODELS_BY_PROVIDER.gemini.map((model) => model.id)).toEqual([
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-pro-preview",
    ]);
  });

  it("이전 Flash 모델은 거부하고 키가 있는 Gemini 목록에는 3.6을 노출한다", () => {
    expect(providerForModel("gemini-2.5-flash")).toBeNull();
    expect(providerForModel("gemini-2.5-pro")).toBeNull();
    expect(providerForModel("gemini-3.6-flash")).toBe("gemini");
    expect(providerForModel("gemini-3.1-pro-preview")).toBe("gemini");
    expect(availableModels(["gemini"]).map((model) => model.id)).toEqual([
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-pro-preview",
    ]);
  });
});
