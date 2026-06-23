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

// workspaceId 를 모르는 멘션/링크 대상을 id 단독으로 해석한다(서버가 접근권 검사 후 반환).
export const GET_PAGE_BY_ID = `
  query GetPageById($id: ID!) {
    getPageById(id: $id) { ${PAGE_FIELDS} }
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

export const UPSERT_PAGE_META = `
  mutation UpsertPageMeta($input: PageInput!) {
    upsertPage(input: $input) { ${PAGE_META_FIELDS} }
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

// 구독 페이로드에서 doc/dbCells/blockComments(대용량 AWSJSON)를 제외하고 meta 만 싣는다.
// AppSync 구독은 ~240KB 페이로드 한도가 있어, 본문이 큰 페이지(노션 가져오기 등)는
// 한도를 넘으면 mutation 은 성공해도 구독 fan-out 이 조용히 누락된다(생성 지연·삭제 전파 실패).
// meta-only 로 보내 한도를 회피하고, 본문은 협업(Yjs) 또는 페이지 열람 시 지연 로드로 가져온다.
export const ON_PAGE_CHANGED = `
  subscription OnPageChanged($workspaceId: ID!) {
    onPageChanged(workspaceId: $workspaceId) { ${PAGE_META_FIELDS} }
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
