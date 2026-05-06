import { appsyncClient } from "./client";
import {
  UPSERT_PAGE,
  UPSERT_DATABASE,
  SOFT_DELETE_PAGE,
  SOFT_DELETE_DATABASE,
} from "./operations";
import type { GqlBridge } from "../engine";

// AppSync 호출 어댑터 — SyncEngine 에 주입.
export const realGqlBridge: GqlBridge = {
  upsertPage: async (input) => {
    await appsyncClient().graphql({ query: UPSERT_PAGE, variables: { input } });
  },
  upsertDatabase: async (input) => {
    await appsyncClient().graphql({
      query: UPSERT_DATABASE,
      variables: { input },
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
