const SHARED_BLOCK_FIELDS = `
  id workspaceId kind data createdAt updatedAt deletedAt
`;

export const GET_SHARED_BLOCK = `
  query GetSharedBlock($id: ID!, $workspaceId: ID!) {
    getSharedBlock(id: $id, workspaceId: $workspaceId) {
      ${SHARED_BLOCK_FIELDS}
    }
  }
`;

export const UPSERT_SHARED_BLOCK = `
  mutation UpsertSharedBlock($input: SharedBlockInput!) {
    upsertSharedBlock(input: $input) {
      ${SHARED_BLOCK_FIELDS}
    }
  }
`;

export type GqlSharedBlock = {
  id: string;
  workspaceId: string;
  kind: "dropdown-menu" | "gallery";
  data: string | Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};
