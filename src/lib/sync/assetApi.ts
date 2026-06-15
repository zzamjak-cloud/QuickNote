// 자산 관리 GraphQL API 래퍼.

import { gqlOptional } from "./graphqlRequest";
import {
  LIST_MY_ASSETS,
  GET_ASSET_USAGES,
  DELETE_MY_ASSETS,
  RENAME_ASSET,
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
  const conn = await gqlOptional<{ items?: GqlAsset[]; nextToken?: string | null }>(
    LIST_MY_ASSETS,
    { input },
    "listMyAssets",
  );
  return {
    items: conn?.items ?? [],
    nextToken: conn?.nextToken ?? null,
  };
}

export async function getAssetUsagesApi(assetId: string): Promise<GqlAssetUsage[]> {
  const usages = await gqlOptional<GqlAssetUsage[]>(
    GET_ASSET_USAGES,
    { assetId },
    "getAssetUsages",
  );
  return usages ?? [];
}

export async function deleteMyAssetsApi(assetIds: string[]): Promise<string[]> {
  const deleted = await gqlOptional<string[]>(
    DELETE_MY_ASSETS,
    { assetIds },
    "deleteMyAssets",
  );
  return deleted ?? [];
}

export async function renameAssetApi(
  assetId: string,
  name: string | null,
): Promise<GqlAsset | null> {
  return gqlOptional<GqlAsset>(RENAME_ASSET, { assetId, name }, "renameAsset");
}

export async function replaceAssetRefApi(
  oldAssetId: string,
  newAssetId: string,
): Promise<number> {
  const count = await gqlOptional<number>(
    REPLACE_ASSET_REF,
    { input: { oldAssetId, newAssetId } },
    "replaceAssetRef",
  );
  return count ?? 0;
}

export async function migrateAssetUsageApi(
  cursor: string | null = null,
): Promise<{ processedRows: number; nextCursor: string | null; hasMore: boolean }> {
  const r = await gqlOptional<{ processedRows?: number; nextCursor?: string | null; hasMore?: boolean }>(
    MIGRATE_ASSET_USAGE,
    { cursor },
    "migrateAssetUsage",
  );
  return {
    processedRows: r?.processedRows ?? 0,
    nextCursor: r?.nextCursor ?? null,
    hasMore: r?.hasMore ?? false,
  };
}
