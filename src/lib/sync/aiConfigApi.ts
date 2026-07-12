// 워크스페이스 AI 설정 API 래퍼 — 키 원문은 서버에 저장되며 어떤 응답에도 포함되지 않는다.

import { appsyncClient } from "./graphql/client";
import {
  GET_WORKSPACE_AI_CONFIG,
  SET_WORKSPACE_AI_KEY,
  CLEAR_WORKSPACE_AI_KEY,
  UPDATE_WORKSPACE_AI_SETTINGS,
} from "./queries/ai";

export type WorkspaceAiConfig = {
  workspaceId: string;
  enabled: boolean;
  provider: string;
  hasKey: boolean;
  apiKeyMasked: string | null;
  defaultModel: string;
  updatedAt: string | null;
};

type GqlEnvelope = {
  data?: Record<string, WorkspaceAiConfig | undefined>;
  errors?: Array<{ message?: string }>;
};

async function callAiConfigField(
  query: string,
  fieldName: string,
  variables: Record<string, unknown>,
): Promise<WorkspaceAiConfig> {
  const result = (await appsyncClient().graphql({ query, variables })) as GqlEnvelope;
  const message = result.errors?.[0]?.message;
  if (message) throw new Error(message);
  const config = result.data?.[fieldName];
  if (!config) throw new Error(`${fieldName} 응답 없음`);
  return config;
}

export async function getWorkspaceAiConfigApi(workspaceId: string): Promise<WorkspaceAiConfig> {
  return callAiConfigField(GET_WORKSPACE_AI_CONFIG, "getWorkspaceAiConfig", { workspaceId });
}

export async function setWorkspaceAiKeyApi(
  workspaceId: string,
  provider: string,
  apiKey: string,
): Promise<WorkspaceAiConfig> {
  return callAiConfigField(SET_WORKSPACE_AI_KEY, "setWorkspaceAiKey", {
    workspaceId,
    provider,
    apiKey,
  });
}

export async function clearWorkspaceAiKeyApi(workspaceId: string): Promise<WorkspaceAiConfig> {
  return callAiConfigField(CLEAR_WORKSPACE_AI_KEY, "clearWorkspaceAiKey", { workspaceId });
}

export async function updateWorkspaceAiSettingsApi(
  workspaceId: string,
  patch: { enabled?: boolean; defaultModel?: string },
): Promise<WorkspaceAiConfig> {
  return callAiConfigField(UPDATE_WORKSPACE_AI_SETTINGS, "updateWorkspaceAiSettings", {
    workspaceId,
    ...patch,
  });
}
