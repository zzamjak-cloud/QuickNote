const PAGE_FIELDS = `
  id workspaceId createdByMemberId title icon coverImage parentId order databaseId
  doc dbCells blockComments createdAt updatedAt deletedAt
`;

const PAGE_HISTORY_FIELDS = `
  pageId historyId workspaceId kind patch anchor createdAt createdByMemberId createdByName
`;

export const LIST_PAGE_HISTORY = `
  query ListPageHistory($pageId: ID!, $workspaceId: ID!, $limit: Int) {
    listPageHistory(pageId: $pageId, workspaceId: $workspaceId, limit: $limit) {
      ${PAGE_HISTORY_FIELDS}
    }
  }
`;

// DB 소속 모든 row 페이지 히스토리를 단일 쿼리로 (byDatabaseAndCreatedAt GSI, 서버 페이지네이션)
export const LIST_DATABASE_ROW_HISTORY = `
  query ListDatabaseRowHistory($databaseId: ID!, $workspaceId: ID!, $limit: Int, $nextToken: String) {
    listDatabaseRowHistory(databaseId: $databaseId, workspaceId: $workspaceId, limit: $limit, nextToken: $nextToken) {
      items { ${PAGE_HISTORY_FIELDS} }
      nextToken
    }
  }
`;

export const RESTORE_PAGE_VERSION = `
  mutation RestorePageVersion($input: RestorePageVersionInput!) {
    restorePageVersion(input: $input) { ${PAGE_FIELDS} }
  }
`;

export const DELETE_PAGE_HISTORY_EVENTS = `
  mutation DeletePageHistoryEvents($pageId: ID!, $workspaceId: ID!, $historyIds: [ID!]!) {
    deletePageHistoryEvents(pageId: $pageId, workspaceId: $workspaceId, historyIds: $historyIds)
  }
`;

export type GqlPageHistoryEntry = {
  pageId: string;
  historyId: string;
  workspaceId: string;
  kind: string;
  patch: unknown;
  anchor?: unknown | null;
  createdAt: string;
  createdByMemberId?: string | null;
  createdByName?: string | null;
};
