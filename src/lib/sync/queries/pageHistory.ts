const PAGE_FIELDS = `
  id workspaceId createdByMemberId title icon coverImage parentId order databaseId
  doc dbCells blockComments createdAt updatedAt deletedAt
`;

// ⚠ 필드 추가 시 infra/lib/sync/schema.graphql 의 PageHistoryEntry 와 동시 수정 + CDK 선배포
//   (스키마에 없는 필드 select 는 쿼리 전체 거부 — wiki/sync/architecture.md 정합 사고 참고)
const PAGE_HISTORY_FIELDS = `
  pageId historyId workspaceId kind patch anchor snapshot changedUnits contributors
  sessionStartedAt lastActivityAt createdAt createdByMemberId createdByName
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
  /** 세션 엔트리(kind page.session)의 post-state 전체 스냅샷(AWSJSON) */
  snapshot?: unknown | null;
  /** 변경 단위 키 목록(AWSJSON): "block:<id>" | "cell:<colId>" | "meta:*" */
  changedUnits?: unknown | null;
  /** 세션 참여 멤버 누적(AWSJSON): [{memberId, name}] */
  contributors?: unknown | null;
  sessionStartedAt?: string | null;
  lastActivityAt?: string | null;
  createdAt: string;
  createdByMemberId?: string | null;
  createdByName?: string | null;
};
