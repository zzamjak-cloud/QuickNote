const COMMENT_FIELDS = `
  id workspaceId pageId blockId authorMemberId bodyText mentionMemberIds parentId
  createdAt updatedAt deletedAt
`;

export const LIST_COMMENTS = `
  query ListComments($workspaceId: ID!, $updatedAfter: AWSDateTime, $limit: Int, $nextToken: String) {
    listComments(workspaceId: $workspaceId, updatedAfter: $updatedAfter, limit: $limit, nextToken: $nextToken) {
      items { ${COMMENT_FIELDS} }
      nextToken
    }
  }
`;

export const UPSERT_COMMENT = `
  mutation UpsertComment($input: CommentInput!) {
    upsertComment(input: $input) { ${COMMENT_FIELDS} }
  }
`;

export const SOFT_DELETE_COMMENT = `
  mutation SoftDeleteComment($id: ID!, $workspaceId: ID!, $updatedAt: AWSDateTime!) {
    softDeleteComment(id: $id, workspaceId: $workspaceId, updatedAt: $updatedAt) { ${COMMENT_FIELDS} }
  }
`;

export const ON_COMMENT_CHANGED = `
  subscription OnCommentChanged($workspaceId: ID!) {
    onCommentChanged(workspaceId: $workspaceId) { ${COMMENT_FIELDS} }
  }
`;

export type GqlComment = {
  id: string;
  workspaceId: string;
  pageId: string;
  blockId: string;
  authorMemberId: string;
  bodyText: string;
  /** AWSJSON — Amplify 가 자동 parse 해주기도 하므로 string | string[] 둘 다 가능 */
  mentionMemberIds: unknown;
  parentId?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};
