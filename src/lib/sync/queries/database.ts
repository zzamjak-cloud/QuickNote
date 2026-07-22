const DATABASE_FIELDS = `
  id workspaceId createdByMemberId title columns presets panelState templates templatesUpdatedAt createdAt updatedAt deletedAt
`;

export const LIST_DATABASES = `
  query ListDatabases($workspaceId: ID!, $updatedAfter: AWSDateTime, $limit: Int, $nextToken: String) {
    listDatabases(workspaceId: $workspaceId, updatedAfter: $updatedAfter, limit: $limit, nextToken: $nextToken) {
      items { ${DATABASE_FIELDS} }
      nextToken
    }
  }
`;

export const GET_DATABASE = `
  query GetDatabase($id: ID!, $workspaceId: ID!) {
    getDatabase(id: $id, workspaceId: $workspaceId) { ${DATABASE_FIELDS} }
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

export const PERMANENTLY_DELETE_DATABASE = `
  mutation PermanentlyDeleteDatabase($id: ID!, $workspaceId: ID!) {
    permanentlyDeleteDatabase(id: $id, workspaceId: $workspaceId)
  }
`;

export const ON_DATABASE_CHANGED = `
  subscription OnDatabaseChanged($workspaceId: ID!) {
    onDatabaseChanged(workspaceId: $workspaceId) { ${DATABASE_FIELDS} }
  }
`;

// 삭제된 DB(휴지통) 조회 — 서버 권위. 보관 기간(30일) 내, 삭제 시각 최신순.
export const LIST_TRASHED_DATABASES = `
  query ListTrashedDatabases($workspaceId: ID!, $limit: Int, $nextToken: String) {
    listTrashedDatabases(workspaceId: $workspaceId, limit: $limit, nextToken: $nextToken) {
      items { ${DATABASE_FIELDS} }
      nextToken
    }
  }
`;

export const RESTORE_DATABASE = `
  mutation RestoreDatabase($id: ID!, $workspaceId: ID!) {
    restoreDatabase(id: $id, workspaceId: $workspaceId) { ${DATABASE_FIELDS} }
  }
`;

export type GqlDatabase = {
  id: string;
  workspaceId: string;
  createdByMemberId: string;
  title: string;
  columns: unknown;
  presets?: unknown | null;
  panelState?: unknown | null;
  templates?: unknown | null;
  templatesUpdatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};
