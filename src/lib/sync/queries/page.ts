// blockComments 는 항상 조회·구독·뮤테이션 응답에 포함한다.
// 빌드 시 env 로 빼면 한 클라이언트만 댓글을 못 읽거나 Put 시 필드가 사라져 동기화가 깨진다.
const PAGE_FIELDS = `
  id workspaceId createdByMemberId title titleColor icon coverImage parentId order databaseId fullPageDatabaseId
  doc dbCells blockComments lastEditedByMemberId lastEditedByName createdAt updatedAt deletedAt
`;

export const LIST_PAGES = `
  query ListPages($workspaceId: ID!, $updatedAfter: AWSDateTime, $limit: Int, $nextToken: String) {
    listPages(workspaceId: $workspaceId, updatedAfter: $updatedAfter, limit: $limit, nextToken: $nextToken) {
      items { ${PAGE_FIELDS} }
      nextToken
    }
  }
`;

const PAGE_META_FIELDS = `
  id workspaceId createdByMemberId title titleColor icon coverImage parentId order databaseId fullPageDatabaseId
  lastEditedByMemberId lastEditedByName createdAt updatedAt deletedAt
`;

export const LIST_PAGE_METAS = `
  query ListPageMetas($workspaceId: ID!, $updatedAfter: AWSDateTime, $limit: Int, $nextToken: String) {
    listPageMetas(workspaceId: $workspaceId, updatedAfter: $updatedAfter, limit: $limit, nextToken: $nextToken) {
      items { ${PAGE_META_FIELDS} }
      nextToken
    }
  }
`;

export const GET_PAGE = `
  query GetPage($id: ID!, $workspaceId: ID!) {
    getPage(id: $id, workspaceId: $workspaceId) { ${PAGE_FIELDS} }
  }
`;

export const LIST_DATABASE_ROWS = `
  query ListDatabaseRows($databaseId: ID!, $workspaceId: ID!, $organizationId: ID, $teamId: ID, $projectId: ID, $assigneeId: ID, $limit: Int, $nextToken: String) {
    listDatabaseRows(databaseId: $databaseId, workspaceId: $workspaceId, organizationId: $organizationId, teamId: $teamId, projectId: $projectId, assigneeId: $assigneeId, limit: $limit, nextToken: $nextToken) {
      items { ${PAGE_FIELDS} }
      nextToken
    }
  }
`;

const DATABASE_ROW_INDEX_FIELDS = `
  id workspaceId title icon order databaseId dbCells createdAt updatedAt deletedAt
`;

export const LIST_DATABASE_ROW_INDEX = `
  query ListDatabaseRowIndex($databaseId: ID!, $workspaceId: ID!, $organizationId: ID, $teamId: ID, $projectId: ID, $assigneeId: ID, $limit: Int, $nextToken: String) {
    listDatabaseRows(databaseId: $databaseId, workspaceId: $workspaceId, organizationId: $organizationId, teamId: $teamId, projectId: $projectId, assigneeId: $assigneeId, limit: $limit, nextToken: $nextToken) {
      items { ${DATABASE_ROW_INDEX_FIELDS} }
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

// 휴지통 리스트 전용 — doc/dbCells/blockComments 등 큰 AWSJSON 필드 제외.
// 휴지통 UI 는 제목·아이콘만 표시하고 복원 시 별도로 전체 페이지를 받으므로 충분.
export const LIST_TRASHED_PAGES_BRIEF = `
  query ListTrashedPagesBrief($workspaceId: ID!, $limit: Int, $nextToken: String) {
    listTrashedPages(workspaceId: $workspaceId, limit: $limit, nextToken: $nextToken) {
      items { id title icon databaseId deletedAt updatedAt }
      nextToken
    }
  }
`;

export type GqlPageBrief = {
  id: string;
  title: string;
  icon?: string | null;
  databaseId?: string | null;
  deletedAt?: string | null;
  updatedAt: string;
};

export const RESTORE_PAGE = `
  mutation RestorePage($id: ID!, $workspaceId: ID!) {
    restorePage(id: $id, workspaceId: $workspaceId) { ${PAGE_FIELDS} }
  }
`;

export const EMPTY_TRASH = `
  mutation EmptyTrash($workspaceId: ID!) {
    emptyTrash(workspaceId: $workspaceId)
  }
`;

export const PERMANENTLY_DELETE_PAGE = `
  mutation PermanentlyDeletePage($id: ID!, $workspaceId: ID!) {
    permanentlyDeletePage(id: $id, workspaceId: $workspaceId)
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
  titleColor?: string | null;
  icon?: string | null;
  coverImage?: string | null;
  parentId?: string | null;
  order?: string | null;
  databaseId?: string | null;
  fullPageDatabaseId?: string | null;
  doc: unknown;
  dbCells?: unknown | null;
  blockComments?: unknown | null;
  lastEditedByMemberId?: string | null;
  lastEditedByName?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type GqlPageMeta = Omit<GqlPage, "doc" | "dbCells" | "blockComments">;

export type GqlDatabaseRowIndexPage = Pick<
  GqlPage,
  | "id"
  | "workspaceId"
  | "title"
  | "icon"
  | "order"
  | "databaseId"
  | "dbCells"
  | "createdAt"
  | "updatedAt"
  | "deletedAt"
>;
