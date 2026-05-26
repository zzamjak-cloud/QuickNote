// 자산 관리 GraphQL API 래퍼.

import { appsyncClient } from "./graphql/client";
import {
  LIST_MY_ASSETS,
  GET_ASSET_USAGES,
  DELETE_MY_ASSETS,
  REPLACE_ASSET_REF,
  MIGRATE_ASSET_USAGE,
  type GqlAsset,
  type GqlAssetUsage,
} from "./graphql/operations";

export type ListMyAssetsInput = {
  sortBy?: "SIZE_DESC" | "SIZE_ASC" | "CREATED_AT_DESC";
  filterMimePrefix?: string;
  filterUnusedOnly?: boolean;
  minSize?: number;
  limit?: number;
  nextToken?: string;
};

export async function listMyAssetsApi(
  input: ListMyAssetsInput | null = null,
): Promise<{ items: GqlAsset[]; nextToken: string | null }> {
  const res = (await appsyncClient().graphql({
    query: LIST_MY_ASSETS,
    variables: { input },
  })) as { data?: { listMyAssets?: { items?: GqlAsset[]; nextToken?: string | null } } };
  return {
    items: res.data?.listMyAssets?.items ?? [],
    nextToken: res.data?.listMyAssets?.nextToken ?? null,
  };
}

export async function getAssetUsagesApi(assetId: string): Promise<GqlAssetUsage[]> {
  const res = (await appsyncClient().graphql({
    query: GET_ASSET_USAGES,
    variables: { assetId },
  })) as { data?: { getAssetUsages?: GqlAssetUsage[] } };
  return res.data?.getAssetUsages ?? [];
}

export async function deleteMyAssetsApi(assetIds: string[]): Promise<string[]> {
  const res = (await appsyncClient().graphql({
    query: DELETE_MY_ASSETS,
    variables: { assetIds },
  })) as { data?: { deleteMyAssets?: string[] } };
  return res.data?.deleteMyAssets ?? [];
}

export async function replaceAssetRefApi(
  oldAssetId: string,
  newAssetId: string,
): Promise<number> {
  const res = (await appsyncClient().graphql({
    query: REPLACE_ASSET_REF,
    variables: { input: { oldAssetId, newAssetId } },
  })) as { data?: { replaceAssetRef?: number } };
  return res.data?.replaceAssetRef ?? 0;
}

export async function migrateAssetUsageApi(
  cursor: string | null = null,
): Promise<{ processedRows: number; nextCursor: string | null; hasMore: boolean }> {
  const res = (await appsyncClient().graphql({
    query: MIGRATE_ASSET_USAGE,
    variables: { cursor },
  })) as {
    data?: {
      migrateAssetUsage?: { processedRows?: number; nextCursor?: string | null; hasMore?: boolean };
    };
  };
  const r = res.data?.migrateAssetUsage;
  return {
    processedRows: r?.processedRows ?? 0,
    nextCursor: r?.nextCursor ?? null,
    hasMore: r?.hasMore ?? false,
  };
}
