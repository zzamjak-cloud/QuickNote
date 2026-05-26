// 자산 관리 GraphQL operations. infra/lib/sync/schema.graphql 의 listMyAssets / getAssetUsages /
// deleteMyAssets / replaceAssetRef / migrateAssetUsage 와 1:1 대응.

const ASSET_FIELDS = `
  id ownerId mimeType size sha256 status createdAt name usageCount compressed
`;

export const LIST_MY_ASSETS = `
  query ListMyAssets($input: ListMyAssetsInput) {
    listMyAssets(input: $input) {
      items { ${ASSET_FIELDS} }
      nextToken
    }
  }
`;

export const GET_ASSET_USAGES = `
  query GetAssetUsages($assetId: ID!) {
    getAssetUsages(assetId: $assetId) {
      assetId ownerId pageId blockId blockType workspaceId pageTitle updatedAt
    }
  }
`;

export const DELETE_MY_ASSETS = `
  mutation DeleteMyAssets($assetIds: [ID!]!) {
    deleteMyAssets(assetIds: $assetIds)
  }
`;

export const RENAME_ASSET = `
  mutation RenameAsset($assetId: ID!, $name: String) {
    renameAsset(assetId: $assetId, name: $name) {
      ${ASSET_FIELDS}
    }
  }
`;

export const REPLACE_ASSET_REF = `
  mutation ReplaceAssetRef($input: ReplaceAssetRefInput!) {
    replaceAssetRef(input: $input)
  }
`;

export const MIGRATE_ASSET_USAGE = `
  mutation MigrateAssetUsage($cursor: String) {
    migrateAssetUsage(cursor: $cursor) {
      processedRows
      nextCursor
      hasMore
    }
  }
`;

export type MigrateAssetUsageResult = {
  processedRows: number;
  nextCursor: string | null;
  hasMore: boolean;
};

export type GqlAssetUsage = {
  assetId: string;
  ownerId: string;
  pageId: string;
  blockId: string | null;
  blockType: string | null;
  workspaceId: string | null;
  pageTitle: string | null;
  updatedAt: string;
};

export type GqlAsset = {
  id: string;
  ownerId: string;
  mimeType: string;
  size: number;
  sha256: string;
  status: "PENDING" | "READY";
  createdAt: string;
  name: string | null;
  usageCount: number | null;
  compressed: boolean | null;
};
