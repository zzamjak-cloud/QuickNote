// OpenRouter 키·모델 화이트리스트 — 서버(infra/lambda/v5-resolvers/handlers/aiConfig.ts)와 일치해야 한다.

/** API 키를 저장하는 통합 제공사. */
export type AiProvider = "openrouter";

/** OpenRouter 모델 slug의 원제공사. 모델 그룹과 번역 모델 선택에 사용한다. */
export type AiModelProvider = "gemini" | "anthropic" | "openai";

export type AiModelOption = { id: string; label: string; provider: AiModelProvider };

export const AI_PROVIDERS: Array<{ id: AiProvider; label: string }> = [
  { id: "openrouter", label: "OpenRouter" },
];

export const AI_MODELS_BY_PROVIDER: Record<AiModelProvider, AiModelOption[]> = {
  gemini: [
    {
      id: "google/gemini-3.8-flash",
      label: "Gemini 3.8 Flash — 최신·고성능 (권장)",
      provider: "gemini",
    },
    {
      id: "google/gemini-3.5-flash",
      label: "Gemini 3.5 Flash — 균형형",
      provider: "gemini",
    },
    {
      id: "google/gemini-3.5-flash-lite",
      label: "Gemini 3.5 Flash-Lite — 빠름·저비용",
      provider: "gemini",
    },
    {
      id: "google/gemini-3.1-pro-preview",
      label: "Gemini 3.1 Pro — 고성능 (Preview)",
      provider: "gemini",
    },
  ],
  anthropic: [
    {
      id: "anthropic/claude-haiku-4.5",
      label: "Claude Haiku 4.5 — 빠름·저비용 (권장)",
      provider: "anthropic",
    },
    {
      id: "anthropic/claude-sonnet-5",
      label: "Claude Sonnet 5 — 고품질",
      provider: "anthropic",
    },
  ],
  openai: [
    {
      id: "openai/gpt-5-mini",
      label: "GPT-5 mini — 빠름·저비용 (권장)",
      provider: "openai",
    },
    { id: "openai/gpt-5.1", label: "GPT-5.1 — 고품질", provider: "openai" },
  ],
};

export const AI_DEFAULT_MODEL_BY_PROVIDER: Record<AiModelProvider, string> = {
  gemini: "google/gemini-3.8-flash",
  anthropic: "anthropic/claude-haiku-4.5",
  openai: "openai/gpt-5-mini",
};

export const AI_DEFAULT_MODEL = AI_DEFAULT_MODEL_BY_PROVIDER.gemini;

/** @deprecated 하위 호환 — Gemini 목록만 */
export const AI_MODELS: AiModelOption[] = AI_MODELS_BY_PROVIDER.gemini;

export function isAiProvider(v: string): v is AiProvider {
  return v === "openrouter";
}

export function providerForModel(model: string): AiModelProvider | null {
  for (const p of Object.keys(AI_MODELS_BY_PROVIDER) as AiModelProvider[]) {
    if (AI_MODELS_BY_PROVIDER[p].some((m) => m.id === model)) return p;
  }
  return null;
}

export function modelsForProvider(provider: string | undefined | null): AiModelOption[] {
  return provider === "anthropic" || provider === "openai" || provider === "gemini"
    ? AI_MODELS_BY_PROVIDER[provider]
    : AI_MODELS_BY_PROVIDER.gemini;
}

export function defaultModelForProvider(provider: string | undefined | null): string {
  return provider === "anthropic" || provider === "openai" || provider === "gemini"
    ? AI_DEFAULT_MODEL_BY_PROVIDER[provider]
    : AI_DEFAULT_MODEL_BY_PROVIDER.gemini;
}

/** OpenRouter 키가 등록되면 화이트리스트의 모든 원제공사 모델을 사용할 수 있다. */
export function availableModels(providersWithKeys: Iterable<string>): AiModelOption[] {
  const hasOpenRouterKey = [...providersWithKeys].some(isAiProvider);
  if (!hasOpenRouterKey) return [];
  return (Object.keys(AI_MODELS_BY_PROVIDER) as AiModelProvider[]).flatMap(
    (provider) => AI_MODELS_BY_PROVIDER[provider],
  );
}
