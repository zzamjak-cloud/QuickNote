const DATABASE_FIELDS = `
  id workspaceId createdByMemberId title columns presets createdAt updatedAt deletedAt
`;

export const LIST_DATABASES = `
  query ListDatabases($workspaceId: ID!, $updatedAfter: AWSDateTime, $limit: Int, $nextToken: String) {
    listDatabases(workspaceId: $workspaceId, updatedAfter: $updatedAfter, limit: $limit, nextToken: $nextToken) {
      items { ${DATABASE_FIELDS} }
      nextToken
    }
  }
`;

export const UPSERT_DATABASE = `
  mutation UpsertDatabase($input: DatabaseInput!) {
    upsertDatabase(input: $input) { ${DATABASE_FIELDS} }
  }
`;

export const SOFT_DELETE_DATABASE = `
  mutation SoftDeleteDatabase($id: ID!, $workspaceId: ID!, $updatedAt: AWSDateTime!) {
    softDeleteDatabase(id: $id, workspaceId: $workspaceId, updatedAt: $updatedAt) { ${DATABASE_FIELDS} }
  }
`;

export const ON_DATABASE_CHANGED = `
  subscription OnDatabaseChanged($workspaceId: ID!) {
    onDatabaseChanged(workspaceId: $workspaceId) { ${DATABASE_FIELDS} }
  }
`;

export type GqlDatabase = {
  id: string;
  workspaceId: string;
  createdByMemberId: string;
  title: string;
  columns: unknown;
  presets?: unknown | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};
