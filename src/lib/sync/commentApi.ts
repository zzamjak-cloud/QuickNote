import { appsyncClient } from "./graphql/client";
import { LIST_COMMENTS, type GqlComment } from "./queries/comment";

type ListCommentsResponse = {
  data?: {
    listComments?: {
      items: GqlComment[];
      nextToken?: string | null;
    };
  };
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
    const res = (await appsyncClient().graphql({
      query: LIST_COMMENTS,
      variables: { workspaceId, updatedAfter, limit: 1000, nextToken },
    })) as ListCommentsResponse;

    const page = res.data?.listComments;
    if (page?.items) {
      all.push(...page.items);
    }
    nextToken = page?.nextToken;
  } while (nextToken);

  return all;
}
