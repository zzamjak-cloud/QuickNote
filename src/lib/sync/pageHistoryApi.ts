import { appsyncClient } from "./graphql/client";
import {
  DELETE_PAGE_HISTORY_EVENTS,
  LIST_PAGE_HISTORY,
  RESTORE_PAGE_VERSION,
  type GqlPage,
  type GqlPageHistoryEntry,
} from "./graphql/operations";

export async function listPageHistoryApi(
  pageId: string,
  workspaceId: string,
  limit = 100,
): Promise<GqlPageHistoryEntry[]> {
  const res = (await appsyncClient().graphql({
    query: LIST_PAGE_HISTORY,
    variables: { pageId, workspaceId, limit },
  })) as { data?: { listPageHistory?: GqlPageHistoryEntry[] } };
  return res.data?.listPageHistory ?? [];
}

export async function restorePageVersionApi(input: {
  pageId: string;
  workspaceId: string;
  historyId: string;
}): Promise<GqlPage> {
  const res = (await appsyncClient().graphql({
    query: RESTORE_PAGE_VERSION,
    variables: { input },
  })) as { data?: { restorePageVersion?: GqlPage } };
  if (!res.data?.restorePageVersion) throw new Error("restorePageVersion 응답 없음");
  return res.data.restorePageVersion;
}

export async function deletePageHistoryEventsApi(
  pageId: string,
  workspaceId: string,
  historyIds: string[],
): Promise<boolean> {
  const res = (await appsyncClient().graphql({
    query: DELETE_PAGE_HISTORY_EVENTS,
    variables: { pageId, workspaceId, historyIds },
  })) as { data?: { deletePageHistoryEvents?: boolean } };
  return Boolean(res.data?.deletePageHistoryEvents);
}
