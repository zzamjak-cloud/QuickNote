// AI 모델 화이트리스트 — 서버(infra/lambda/v5-resolvers/handlers/aiConfig.ts)와 일치해야 한다.

export type AiModelOption = { id: string; label: string };

export const AI_DEFAULT_MODEL = "gemini-2.5-flash";

export const AI_MODELS: AiModelOption[] = [
  { id: AI_DEFAULT_MODEL, label: "Gemini 2.5 Flash — 빠름·저비용 (권장)" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro — 고품질" },
];
