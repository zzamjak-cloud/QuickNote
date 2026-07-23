import { appsyncClient } from "./client";
import {
  UPSERT_PAGE,
  UPSERT_PAGE_META,
  UPSERT_DATABASE,
  SOFT_DELETE_PAGE,
  SOFT_DELETE_DATABASE,
} from "./operations";
import { UPDATE_MY_CLIENT_PREFS } from "../queries/member";
import {
  UPSERT_COMMENT,
  SOFT_DELETE_COMMENT,
  TOGGLE_COMMENT_REACTION,
} from "../queries/comment";
import type { GqlBridge } from "../engine";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../scheduler/scope";

const FORCE_DELETE_UPDATED_AT = "9999-12-31T23:59:59.999Z";
const META_ONLY_PAGE_UPSERT_FLAG = "__metaOnly";

// AppSync AWSJSON 스칼라는 JSON 문자열을 요구한다.
// v5.0.4 이전 형식(객체)으로 큐잉된 outbox stale entry 도 송신 직전에 정규화해
// 'Variable has an invalid value' 검증 오류 없이 통과시킨다.
function normalizeAwsJsonFields(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const i = { ...(input as Record<string, unknown>) };
  for (const key of ["doc", "dbCells", "columns", "presets", "blockComments", "mentionMemberIds", "reactions"] as const) {
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
    "titleColor",
    "icon",
    "coverImage",
    "parentId",
    "order",
    "databaseId",
    "fullPageDatabaseId",
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

function isMetaOnlyPageInput(input: unknown): boolean {
  return Boolean(
    input &&
      typeof input === "object" &&
      (input as Record<string, unknown>)[META_ONLY_PAGE_UPSERT_FLAG] === true,
  );
}

function getGraphQLErrorMessage(error: unknown): string {
  // Amplify v6 는 에러를 { errors: [{ message }] } / GraphQLError { extensions } / cause 체인 등
  // 다양한 형태로 래핑한다. 모든 경로를 재귀로 훑어 가능한 모든 message/errorType 을 모은다.
  const parts: string[] = [];
  const visit = (val: unknown, depth: number): void => {
    if (depth > 4 || val == null) return;
    if (typeof val === "string") {
      if (val) parts.push(val);
      return;
    }
    if (val instanceof Error) {
      if (val.message) parts.push(val.message);
      const cause = (val as { cause?: unknown }).cause;
      if (cause) visit(cause, depth + 1);
      return;
    }
    if (Array.isArray(val)) {
      for (const item of val) visit(item, depth + 1);
      return;
    }
    if (typeof val === "object") {
      const obj = val as Record<string, unknown>;
      if (typeof obj.message === "string" && obj.message) parts.push(obj.message);
      if (typeof obj.errorType === "string" && obj.errorType) parts.push(obj.errorType);
      if (typeof obj.errorInfo === "string" && obj.errorInfo) parts.push(obj.errorInfo);
      if (obj.errors) visit(obj.errors, depth + 1);
      if (obj.graphQLErrors) visit(obj.graphQLErrors, depth + 1);
      if (obj.networkError) visit(obj.networkError, depth + 1);
      if (obj.cause) visit(obj.cause, depth + 1);
      if (obj.extensions) visit(obj.extensions, depth + 1);
    }
  };
  visit(error, 0);
  if (parts.length > 0) return parts.join(" | ");
  try {
    return JSON.stringify(error) || String(error);
  } catch {
    return String(error);
  }
}

function isResourceGoneError(message: string): boolean {
  const m = message.normalize("NFKC").toLowerCase();
  return (
    m.includes("리소스 없음")
    || (m.includes("리소스") && m.includes("없"))
    || m.includes("resource not found")
    || m.includes("no resource")
    || m.includes("not found")
  );
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
    const message = getGraphQLErrorMessage(error);
    if (isResourceGoneError(message)) return;
    if (!message.includes("The conditional request failed")) {
      throw error;
    }
    try {
      await softDeletePageRequest(id, workspaceId, FORCE_DELETE_UPDATED_AT);
    } catch (retryError) {
      const retryMessage = getGraphQLErrorMessage(retryError);
      if (isResourceGoneError(retryMessage) || retryMessage.includes("The conditional request failed")) {
        return;
      }
      throw retryError;
    }
  }
}

async function softDeleteDatabaseRequest(id: string, workspaceId: string, updatedAt: string): Promise<void> {
  await appsyncClient().graphql({
    query: SOFT_DELETE_DATABASE,
    variables: { id, workspaceId, updatedAt },
  });
}

async function softDeleteDatabaseWithForceRetry(
  id: string,
  workspaceId: string,
  updatedAt: string,
): Promise<void> {
  try {
    await softDeleteDatabaseRequest(id, workspaceId, updatedAt);
  } catch (error) {
    const message = getGraphQLErrorMessage(error);
    if (isResourceGoneError(message)) return;
    if (!message.includes("The conditional request failed")) {
      throw error;
    }
    try {
      await softDeleteDatabaseRequest(id, workspaceId, FORCE_DELETE_UPDATED_AT);
    } catch (retryError) {
      const retryMessage = getGraphQLErrorMessage(retryError);
      if (isResourceGoneError(retryMessage) || retryMessage.includes("The conditional request failed")) {
        return;
      }
      throw retryError;
    }
  }
}

// AppSync 호출 어댑터 — SyncEngine 에 주입.
export const realGqlBridge: GqlBridge = {
  upsertPage: async (input) => {
    const metaOnly = isMetaOnlyPageInput(input);
    await appsyncClient().graphql({
      query: metaOnly ? UPSERT_PAGE_META : UPSERT_PAGE,
      variables: { input: normalizeAwsJsonFields(normalizePageInput(input)) },
    });
  },
  upsertDatabase: async (input) => {
    const normalizedInput = normalizeAwsJsonFields(input);
    await appsyncClient().graphql({
      query: UPSERT_DATABASE,
      variables: { input: normalizedInput },
    });
  },
  softDeletePage: async (id, workspaceId, updatedAt) => {
    try {
      await softDeletePageWithForceRetry(id, workspaceId, updatedAt);
    } catch (error) {
      const message = getGraphQLErrorMessage(error);
      if (isResourceGoneError(message)) return;
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
    await softDeleteDatabaseWithForceRetry(id, workspaceId, updatedAt);
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
  toggleCommentReaction: async (input) => {
    await appsyncClient().graphql({
      query: TOGGLE_COMMENT_REACTION,
      variables: { input },
    });
  },
  softDeleteComment: async (id, workspaceId, updatedAt) => {
    await appsyncClient().graphql({
      query: SOFT_DELETE_COMMENT,
      variables: { id, workspaceId, updatedAt },
    });
  },
};
