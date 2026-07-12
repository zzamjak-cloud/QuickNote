// 워크스페이스 AI 설정·사용량 API 래퍼 — 키 원문은 서버에 저장되며 어떤 응답에도 포함되지 않는다.

import { appsyncClient } from "./graphql/client";
import {
  GET_WORKSPACE_AI_CONFIG,
  GET_WORKSPACE_AI_USAGE,
  SET_WORKSPACE_AI_KEY,
  CLEAR_WORKSPACE_AI_KEY,
  UPDATE_WORKSPACE_AI_SETTINGS,
} from "./queries/ai";

export type WorkspaceAiProviderKey = {
  provider: string;
  hasKey: boolean;
  apiKeyMasked: string | null;
};

export type WorkspaceAiConfig = {
  workspaceId: string;
  enabled: boolean;
  provider: string;
  hasKey: boolean;
  apiKeyMasked: string | null;
  providers: WorkspaceAiProviderKey[];
  defaultModel: string;
  /** 월 토큰 한도(입력+출력 합산). 0 = 무제한. */
  monthlyTokenLimit: number;
  updatedAt: string | null;
};

export type AiUsageMemberEntry = {
  memberId: string;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
};

export type WorkspaceAiUsage = {
  workspaceId: string;
  month: string;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
  members: AiUsageMemberEntry[];
};

type GqlEnvelope<T> = {
  data?: Record<string, T | undefined>;
  errors?: Array<{ message?: string }>;
};

async function callField<T>(
  query: string,
  fieldName: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const result = (await appsyncClient().graphql({ query, variables })) as GqlEnvelope<T>;
  const message = result.errors?.[0]?.message;
  if (message) throw new Error(message);
  const value = result.data?.[fieldName];
  if (!value) throw new Error(`${fieldName} 응답 없음`);
  return value;
}

export async function getWorkspaceAiConfigApi(workspaceId: string): Promise<WorkspaceAiConfig> {
  return callField(GET_WORKSPACE_AI_CONFIG, "getWorkspaceAiConfig", { workspaceId });
}

export async function getWorkspaceAiUsageApi(
  workspaceId: string,
  month?: string,
): Promise<WorkspaceAiUsage> {
  return callField(GET_WORKSPACE_AI_USAGE, "getWorkspaceAiUsage", {
    workspaceId,
    month: month ?? null,
  });
}

export async function setWorkspaceAiKeyApi(
  workspaceId: string,
  provider: string,
  apiKey: string,
): Promise<WorkspaceAiConfig> {
  return callField(SET_WORKSPACE_AI_KEY, "setWorkspaceAiKey", {
    workspaceId,
    provider,
    apiKey,
  });
}

export async function clearWorkspaceAiKeyApi(
  workspaceId: string,
  provider: string,
): Promise<WorkspaceAiConfig> {
  return callField(CLEAR_WORKSPACE_AI_KEY, "clearWorkspaceAiKey", {
    workspaceId,
    provider,
  });
}

export async function updateWorkspaceAiSettingsApi(
  workspaceId: string,
  patch: { enabled?: boolean; defaultModel?: string; monthlyTokenLimit?: number },
): Promise<WorkspaceAiConfig> {
  return callField(UPDATE_WORKSPACE_AI_SETTINGS, "updateWorkspaceAiSettings", {
    workspaceId,
    ...patch,
  });
}
