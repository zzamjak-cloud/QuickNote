import { appsyncClient } from "./client";
import {
  UPSERT_PAGE,
  UPSERT_DATABASE,
  SOFT_DELETE_PAGE,
  SOFT_DELETE_DATABASE,
} from "./operations";
import { UPDATE_MY_CLIENT_PREFS } from "../queries/member";
import { UPSERT_COMMENT, SOFT_DELETE_COMMENT } from "../queries/comment";
import type { GqlBridge } from "../engine";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../scheduler/scope";

const FORCE_DELETE_UPDATED_AT = "9999-12-31T23:59:59.999Z";

// AppSync AWSJSON 스칼라는 JSON 문자열을 요구한다.
// v5.0.4 이전 형식(객체)으로 큐잉된 outbox stale entry 도 송신 직전에 정규화해
// 'Variable has an invalid value' 검증 오류 없이 통과시킨다.
function normalizeAwsJsonFields(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const i = { ...(input as Record<string, unknown>) };
  for (const key of ["doc", "dbCells", "columns", "presets", "blockComments", "mentionMemberIds"] as const) {
    const v = i[key];
    if (v != null && typeof v !== "string") {
      i[key] = JSON.stringify(v);
    }
  }
  return i;
}

function normalizePageInput(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const i = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of [
    "id",
    "workspaceId",
    "createdByMemberId",
    "title",
    "icon",
    "coverImage",
    "parentId",
    "order",
    "databaseId",
    "doc",
    "dbCells",
    "blockComments",
    "createdAt",
    "updatedAt",
  ]) {
    if (key in i) out[key] = i[key];
  }
  return out;
}

function getGraphQLErrorMessage(error: unknown): string {
  const errors = (error as { errors?: unknown[] } | null)?.errors;
  const first = Array.isArray(errors) ? errors[0] : null;
  return (first as { message?: string } | null)?.message
    ?? (error instanceof Error ? error.message : String(error));
}

async function softDeletePageRequest(id: string, workspaceId: string, updatedAt: string): Promise<void> {
  await appsyncClient().graphql({
    query: SOFT_DELETE_PAGE,
    variables: { id, workspaceId, updatedAt },
  });
}

async function softDeletePageWithForceRetry(id: string, workspaceId: string, updatedAt: string): Promise<void> {
  try {
    await softDeletePageRequest(id, workspaceId, updatedAt);
  } catch (error) {
    if (!getGraphQLErrorMessage(error).includes("The conditional request failed")) {
      throw error;
    }
    try {
      await softDeletePageRequest(id, workspaceId, FORCE_DELETE_UPDATED_AT);
    } catch (retryError) {
      if (getGraphQLErrorMessage(retryError).includes("The conditional request failed")) {
        return;
      }
      throw retryError;
    }
  }
}

// AppSync 호출 어댑터 — SyncEngine 에 주입.
export const realGqlBridge: GqlBridge = {
  upsertPage: async (input) => {
    await appsyncClient().graphql({
      query: UPSERT_PAGE,
      variables: { input: normalizeAwsJsonFields(normalizePageInput(input)) },
    });
  },
  upsertDatabase: async (input) => {
    await appsyncClient().graphql({
      query: UPSERT_DATABASE,
      variables: { input: normalizeAwsJsonFields(input) },
    });
  },
  softDeletePage: async (id, workspaceId, updatedAt) => {
    try {
      await softDeletePageWithForceRetry(id, workspaceId, updatedAt);
    } catch (error) {
      const message = getGraphQLErrorMessage(error);
      if (
        workspaceId !== LC_SCHEDULER_WORKSPACE_ID &&
        message.includes("The conditional request failed")
      ) {
        await softDeletePageWithForceRetry(id, LC_SCHEDULER_WORKSPACE_ID, updatedAt);
        return;
      }
      throw error;
    }
  },
  softDeleteDatabase: async (id, workspaceId, updatedAt) => {
    await appsyncClient().graphql({
      query: SOFT_DELETE_DATABASE,
      variables: { id, workspaceId, updatedAt },
    });
  },
  updateMyClientPrefs: async (clientPrefsJson) => {
    const clientPrefs =
      typeof clientPrefsJson === "string" ? clientPrefsJson : JSON.stringify(clientPrefsJson);
    const raw = await appsyncClient().graphql({
      query: UPDATE_MY_CLIENT_PREFS,
      variables: { input: { clientPrefs } },
    });
    const result = raw as {
      data?: { updateMyClientPrefs?: { memberId?: string; clientPrefs?: unknown } };
      errors?: { message?: string; path?: unknown }[];
    };
    if (Array.isArray(result.errors) && result.errors.length > 0) {
      console.error("[sync] updateMyClientPrefs GraphQL errors", result.errors);
      throw new Error(
        result.errors
          .map((e) => e.message ?? "")
          .filter(Boolean)
          .join("; ") || "updateMyClientPrefs GraphQL error",
      );
    }
  },
  upsertComment: async (input) => {
    await appsyncClient().graphql({
      query: UPSERT_COMMENT,
      variables: { input: normalizeAwsJsonFields(input) },
    });
  },
  softDeleteComment: async (id, workspaceId, updatedAt) => {
    await appsyncClient().graphql({
      query: SOFT_DELETE_COMMENT,
      variables: { id, workspaceId, updatedAt },
    });
  },
};
