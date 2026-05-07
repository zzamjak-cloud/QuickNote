import { appsyncClient } from "./client";
import {
  UPSERT_PAGE,
  UPSERT_DATABASE,
  SOFT_DELETE_PAGE,
  SOFT_DELETE_DATABASE,
} from "./operations";
import type { GqlBridge } from "../engine";

// AppSync AWSJSON 스칼라는 JSON 문자열을 요구한다.
// v5.0.4 이전 형식(객체)으로 큐잉된 outbox stale entry 도 송신 직전에 정규화해
// 'Variable has an invalid value' 검증 오류 없이 통과시킨다.
function normalizeAwsJsonFields(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const i = { ...(input as Record<string, unknown>) };
  for (const key of ["doc", "dbCells", "columns"] as const) {
    const v = i[key];
    if (v != null && typeof v !== "string") {
      i[key] = JSON.stringify(v);
    }
  }
  return i;
}

// AppSync 호출 어댑터 — SyncEngine 에 주입.
export const realGqlBridge: GqlBridge = {
  upsertPage: async (input) => {
    await appsyncClient().graphql({
      query: UPSERT_PAGE,
      variables: { input: normalizeAwsJsonFields(input) },
    });
  },
  upsertDatabase: async (input) => {
    await appsyncClient().graphql({
      query: UPSERT_DATABASE,
      variables: { input: normalizeAwsJsonFields(input) },
    });
  },
  softDeletePage: async (id, workspaceId, updatedAt) => {
    await appsyncClient().graphql({
      query: SOFT_DELETE_PAGE,
      variables: { id, workspaceId, updatedAt },
    });
  },
  softDeleteDatabase: async (id, workspaceId, updatedAt) => {
    await appsyncClient().graphql({
      query: SOFT_DELETE_DATABASE,
      variables: { id, workspaceId, updatedAt },
    });
  },
};
