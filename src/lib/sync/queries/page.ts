const PAGE_FIELDS = `
  id workspaceId createdByMemberId title icon coverImage parentId order databaseId
  doc dbCells createdAt updatedAt deletedAt
`;

export const LIST_PAGES = `
  query ListPages($workspaceId: ID!, $updatedAfter: AWSDateTime, $limit: Int, $nextToken: String) {
    listPages(workspaceId: $workspaceId, updatedAfter: $updatedAfter, limit: $limit, nextToken: $nextToken) {
      items { ${PAGE_FIELDS} }
      nextToken
    }
  }
`;

export const UPSERT_PAGE = `
  mutation UpsertPage($input: PageInput!) {
    upsertPage(input: $input) { ${PAGE_FIELDS} }
  }
`;

export const SOFT_DELETE_PAGE = `
  mutation SoftDeletePage($id: ID!, $workspaceId: ID!, $updatedAt: AWSDateTime!) {
    softDeletePage(id: $id, workspaceId: $workspaceId, updatedAt: $updatedAt) { ${PAGE_FIELDS} }
  }
`;

export const LIST_TRASHED_PAGES = `
  query ListTrashedPages($workspaceId: ID!, $limit: Int, $nextToken: String) {
    listTrashedPages(workspaceId: $workspaceId, limit: $limit, nextToken: $nextToken) {
      items { ${PAGE_FIELDS} }
      nextToken
    }
  }
`;

export const RESTORE_PAGE = `
  mutation RestorePage($id: ID!, $workspaceId: ID!) {
    restorePage(id: $id, workspaceId: $workspaceId) { ${PAGE_FIELDS} }
  }
`;

export const ON_PAGE_CHANGED = `
  subscription OnPageChanged($workspaceId: ID!) {
    onPageChanged(workspaceId: $workspaceId) { ${PAGE_FIELDS} }
  }
`;

export type GqlPage = {
  id: string;
  workspaceId: string;
  createdByMemberId: string;
  title: string;
  icon?: string | null;
  coverImage?: string | null;
  parentId?: string | null;
  order: string;
  databaseId?: string | null;
  doc: unknown;
  dbCells?: unknown | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};
