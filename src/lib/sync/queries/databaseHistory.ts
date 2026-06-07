const DATABASE_FIELDS = `
  id workspaceId createdByMemberId title columns presets panelState templates createdAt updatedAt deletedAt
`;

const DATABASE_HISTORY_FIELDS = `
  databaseId historyId workspaceId ownerId kind patch anchor createdAt createdByMemberId createdByName
`;

export const LIST_DATABASE_HISTORY = `
  query ListDatabaseHistory($databaseId: ID!, $workspaceId: ID!, $limit: Int) {
    listDatabaseHistory(databaseId: $databaseId, workspaceId: $workspaceId, limit: $limit) {
      ${DATABASE_HISTORY_FIELDS}
    }
  }
`;

export const RESTORE_DATABASE_VERSION = `
  mutation RestoreDatabaseVersion($input: RestoreDatabaseVersionInput!) {
    restoreDatabaseVersion(input: $input) { ${DATABASE_FIELDS} }
  }
`;

export const DELETE_DATABASE_HISTORY_EVENTS = `
  mutation DeleteDatabaseHistoryEvents($databaseId: ID!, $workspaceId: ID!, $historyIds: [ID!]!) {
    deleteDatabaseHistoryEvents(databaseId: $databaseId, workspaceId: $workspaceId, historyIds: $historyIds)
  }
`;

export type GqlDatabaseHistoryEntry = {
  databaseId: string;
  historyId: string;
  workspaceId: string;
  ownerId: string;
  kind: string;
  patch: unknown;
  anchor?: unknown | null;
  createdAt: string;
  createdByMemberId?: string | null;
  createdByName?: string | null;
};
