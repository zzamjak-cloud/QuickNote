import { appsyncClient } from "./graphql/client";
import {
  DELETE_PAGE_HISTORY_EVENTS,
  LIST_DATABASE_ROW_HISTORY,
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

/** DB 소속 모든 row 페이지 히스토리를 단일 GSI 쿼리로(삭제된 행 포함). 서버 페이지네이션. */
export async function listDatabaseRowHistoryApi(
  databaseId: string,
  workspaceId: string,
  limit = 100,
  nextToken?: string | null,
): Promise<{ items: GqlPageHistoryEntry[]; nextToken: string | null }> {
  const res = (await appsyncClient().graphql({
    query: LIST_DATABASE_ROW_HISTORY,
    variables: { databaseId, workspaceId, limit, nextToken: nextToken ?? null },
  })) as {
    data?: {
      listDatabaseRowHistory?: { items?: GqlPageHistoryEntry[]; nextToken?: string | null };
    };
  };
  return {
    items: res.data?.listDatabaseRowHistory?.items ?? [],
    nextToken: res.data?.listDatabaseRowHistory?.nextToken ?? null,
  };
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
