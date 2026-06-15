import { gqlOptional } from "./graphqlRequest";
import { LIST_COMMENTS, type GqlComment } from "./queries/comment";

type CommentPage = {
  items: GqlComment[];
  nextToken?: string | null;
};

/**
 * 워크스페이스의 댓글을 페이지네이션으로 페치한다.
 * updatedAfter 를 주면 그 시각 이후 변경분만(증분) 받아 비용을 줄인다.
 */
export async function fetchCommentsByWorkspace(
  workspaceId: string,
  updatedAfter?: string,
): Promise<GqlComment[]> {
  const all: GqlComment[] = [];
  let nextToken: string | null | undefined = undefined;

  do {
    const page = await gqlOptional<CommentPage>(
      LIST_COMMENTS,
      { workspaceId, updatedAfter, limit: 1000, nextToken },
      "listComments",
    );

    if (page?.items) {
      all.push(...page.items);
    }
    nextToken = page?.nextToken;
  } while (nextToken);

  return all;
}
