// AI 제공사·모델 화이트리스트 — 서버(infra/lambda/v5-resolvers/handlers/aiConfig.ts)와 일치해야 한다.

export type AiProvider = "gemini" | "anthropic";

export type AiModelOption = { id: string; label: string };

export const AI_PROVIDERS: Array<{ id: AiProvider; label: string }> = [
  { id: "gemini", label: "Google Gemini" },
  { id: "anthropic", label: "Anthropic Claude" },
];

export const AI_MODELS_BY_PROVIDER: Record<AiProvider, AiModelOption[]> = {
  gemini: [
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash — 빠름·저비용 (권장)" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro — 고품질" },
  ],
  anthropic: [
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 — 빠름·저비용 (권장)" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5 — 고품질" },
  ],
};

export const AI_DEFAULT_MODEL_BY_PROVIDER: Record<AiProvider, string> = {
  gemini: "gemini-2.5-flash",
  anthropic: "claude-haiku-4-5",
};

/** @deprecated 제공사별 기본값 사용 — 하위 호환용 */
export const AI_DEFAULT_MODEL = AI_DEFAULT_MODEL_BY_PROVIDER.gemini;

/** 채팅 패널 등에서 제공사 모를 때 전체 목록(Gemini 기본). */
export const AI_MODELS: AiModelOption[] = AI_MODELS_BY_PROVIDER.gemini;

export function isAiProvider(v: string): v is AiProvider {
  return v === "gemini" || v === "anthropic";
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
