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

/** 워크스페이스의 모든 댓글을 페이지네이션으로 전량 페치한다. */
export async function fetchCommentsByWorkspace(workspaceId: string): Promise<GqlComment[]> {
  const all: GqlComment[] = [];
  let nextToken: string | null | undefined = undefined;

  do {
    const res = (await appsyncClient().graphql({
      query: LIST_COMMENTS,
      variables: { workspaceId, limit: 1000, nextToken },
    })) as ListCommentsResponse;

    const page = res.data?.listComments;
    if (page?.items) {
      all.push(...page.items);
    }
    nextToken = page?.nextToken;
  } while (nextToken);

  return all;
}
