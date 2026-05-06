import { appsyncClient } from "./client";
import {
  UPSERT_PAGE,
  UPSERT_DATABASE,
  UPSERT_CONTACT,
  SOFT_DELETE_PAGE,
  SOFT_DELETE_DATABASE,
  SOFT_DELETE_CONTACT,
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
  upsertContact: async (input) => {
    await appsyncClient().graphql({
      query: UPSERT_CONTACT,
      variables: { input },
    });
  },
  softDeletePage: async (id, updatedAt) => {
    await appsyncClient().graphql({
      query: SOFT_DELETE_PAGE,
      variables: { id, updatedAt },
    });
  },
  softDeleteDatabase: async (id, updatedAt) => {
    await appsyncClient().graphql({
      query: SOFT_DELETE_DATABASE,
      variables: { id, updatedAt },
    });
  },
  softDeleteContact: async (id, updatedAt) => {
    await appsyncClient().graphql({
      query: SOFT_DELETE_CONTACT,
      variables: { id, updatedAt },
    });
  },
};
