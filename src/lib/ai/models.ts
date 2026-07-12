// AI 제공사·모델 화이트리스트 — 서버(infra/lambda/v5-resolvers/handlers/aiConfig.ts)와 일치해야 한다.

export type AiProvider = "gemini" | "anthropic" | "openai";

export type AiModelOption = { id: string; label: string; provider: AiProvider };

export const AI_PROVIDERS: Array<{ id: AiProvider; label: string }> = [
  { id: "gemini", label: "Google Gemini" },
  { id: "anthropic", label: "Anthropic Claude" },
  { id: "openai", label: "OpenAI ChatGPT" },
];

export const AI_MODELS_BY_PROVIDER: Record<AiProvider, AiModelOption[]> = {
  gemini: [
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash — 빠름·저비용 (권장)", provider: "gemini" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro — 고품질", provider: "gemini" },
  ],
  anthropic: [
    {
      id: "claude-haiku-4-5",
      label: "Claude Haiku 4.5 — 빠름·저비용 (권장)",
      provider: "anthropic",
    },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5 — 고품질", provider: "anthropic" },
  ],
  openai: [
    { id: "gpt-5-mini", label: "GPT-5 mini — 빠름·저비용 (권장)", provider: "openai" },
    { id: "gpt-5.1", label: "GPT-5.1 — 고품질", provider: "openai" },
  ],
};

export const AI_DEFAULT_MODEL_BY_PROVIDER: Record<AiProvider, string> = {
  gemini: "gemini-2.5-flash",
  anthropic: "claude-haiku-4-5",
  openai: "gpt-5-mini",
};

/** @deprecated 하위 호환 */
export const AI_DEFAULT_MODEL = AI_DEFAULT_MODEL_BY_PROVIDER.gemini;

/** @deprecated 하위 호환 — Gemini 목록만 */
export const AI_MODELS: AiModelOption[] = AI_MODELS_BY_PROVIDER.gemini;

export function isAiProvider(v: string): v is AiProvider {
  return v === "gemini" || v === "anthropic" || v === "openai";
}

export function providerForModel(model: string): AiProvider | null {
  for (const p of Object.keys(AI_MODELS_BY_PROVIDER) as AiProvider[]) {
    if (AI_MODELS_BY_PROVIDER[p].some((m) => m.id === model)) return p;
  }
  return null;
}

export function modelsForProvider(provider: string | undefined | null): AiModelOption[] {
  return isAiProvider(provider ?? "")
    ? AI_MODELS_BY_PROVIDER[provider as AiProvider]
    : AI_MODELS_BY_PROVIDER.gemini;
}

export function defaultModelForProvider(provider: string | undefined | null): string {
  return isAiProvider(provider ?? "")
    ? AI_DEFAULT_MODEL_BY_PROVIDER[provider as AiProvider]
    : AI_DEFAULT_MODEL_BY_PROVIDER.gemini;
}

/** 키가 등록된 제공사들의 모델 합집합(채팅 셀렉터용). */
export function availableModels(providersWithKeys: Iterable<string>): AiModelOption[] {
  const set = new Set(
    [...providersWithKeys].filter((p): p is AiProvider => isAiProvider(p)),
  );
  return (Object.keys(AI_MODELS_BY_PROVIDER) as AiProvider[])
    .filter((p) => set.has(p))
    .flatMap((p) => AI_MODELS_BY_PROVIDER[p]);
}
