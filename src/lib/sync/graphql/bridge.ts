import { appsyncClient } from "./client";
import {
  UPSERT_PAGE,
  UPSERT_DATABASE,
  SOFT_DELETE_PAGE,
  SOFT_DELETE_DATABASE,
} from "./operations";
import { UPDATE_MY_CLIENT_PREFS } from "../queries/member";
import type { GqlBridge } from "../engine";

/** `clientPrefsSync` 와 동일 태그 — 콘솔 필터 통일 */
const QN_PREFS_LOG = "[QN clientPrefs]";

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
      console.error(`${QN_PREFS_LOG} bridge: updateMyClientPrefs GraphQL errors`, result.errors);
      throw new Error(
        result.errors
          .map((e) => e.message ?? "")
          .filter(Boolean)
          .join("; ") || "updateMyClientPrefs GraphQL error",
      );
    }
    const m = result.data?.updateMyClientPrefs;
    if (!m) {
      console.warn(`${QN_PREFS_LOG} bridge: updateMyClientPrefs data 없음`, {
        dataKeys: result.data ? Object.keys(result.data) : [],
      });
    }
    console.info(`${QN_PREFS_LOG} bridge: updateMyClientPrefs data 수신`, {
      hasData: Boolean(result.data),
      memberIdSuffix:
        m?.memberId && m.memberId.length > 8 ? `…${m.memberId.slice(-8)}` : m?.memberId,
      returnedClientPrefsType:
        m?.clientPrefs == null || m?.clientPrefs === undefined
          ? String(m?.clientPrefs)
          : typeof m.clientPrefs,
    });
  },
};
