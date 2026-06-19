const DATABASE_FIELDS = `
  id workspaceId createdByMemberId title columns presets panelState templates createdAt updatedAt deletedAt
`;

// ⚠ 필드 추가 시 infra/lib/sync/schema.graphql 의 DatabaseHistoryEntry 와 동시 수정 + CDK 선배포
const DATABASE_HISTORY_FIELDS = `
  databaseId historyId workspaceId ownerId kind patch anchor snapshot changedUnits contributors
  sessionStartedAt lastActivityAt createdAt createdByMemberId createdByName
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

export const SAVE_DATABASE_VERSION = `
  mutation SaveDatabaseVersion($databaseId: ID!, $workspaceId: ID!) {
    saveDatabaseVersion(databaseId: $databaseId, workspaceId: $workspaceId) { ${DATABASE_FIELDS} }
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
  /** 세션 엔트리(kind database.session)의 post-state 전체 스냅샷(AWSJSON) */
  snapshot?: unknown | null;
  /** 변경 단위 키 목록(AWSJSON): "column:<id>" | "preset:<id>" | "templates" | "meta:title" */
  changedUnits?: unknown | null;
  contributors?: unknown | null;
  sessionStartedAt?: string | null;
  lastActivityAt?: string | null;
  createdAt: string;
  createdByMemberId?: string | null;
  createdByName?: string | null;
};
