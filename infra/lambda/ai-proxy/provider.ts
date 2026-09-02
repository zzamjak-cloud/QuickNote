// AI 공급사 어댑터 공통 타입 — 스트리밍 결과와 오류 클래스.
// 실제 호출 어댑터는 OpenRouter(openai.ts) 하나뿐이며, 이 모듈은 어댑터와
// Lambda 핸들러(index.ts)가 함께 쓰는 계약만 담는다.
import type { AiGeminiHistoryPart, AiToolCall } from "./tools";

export type AiStreamResult = {
  inputTokens: number;
  outputTokens: number;
  finishReason: string | null;
  toolCalls: AiToolCall[];
  /** 히스토리 왕복용 원문 파트. 현재 OpenRouter 경로에서는 채우지 않는다. */
  geminiParts?: AiGeminiHistoryPart[];
};

export class ProviderError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfterSec: number | null = null,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
