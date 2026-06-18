import { gqlOptional, gqlRequired } from "./graphqlRequest";
import {
  DELETE_PAGE_HISTORY_EVENTS,
  LIST_DATABASE_ROW_HISTORY,
  LIST_PAGE_HISTORY,
  RESTORE_PAGE_VERSION,
  SAVE_PAGE_VERSION,
  type GqlPage,
  type GqlPageHistoryEntry,
} from "./graphql/operations";

export async function listPageHistoryApi(
  pageId: string,
  workspaceId: string,
  limit = 100,
): Promise<GqlPageHistoryEntry[]> {
  const entries = await gqlOptional<GqlPageHistoryEntry[]>(
    LIST_PAGE_HISTORY,
    { pageId, workspaceId, limit },
    "listPageHistory",
  );
  return entries ?? [];
}

/** DB 소속 모든 row 페이지 히스토리를 단일 GSI 쿼리로(삭제된 행 포함). 서버 페이지네이션. */
export async function listDatabaseRowHistoryApi(
  databaseId: string,
  workspaceId: string,
  limit = 100,
  nextToken?: string | null,
): Promise<{ items: GqlPageHistoryEntry[]; nextToken: string | null }> {
  const conn = await gqlOptional<{ items?: GqlPageHistoryEntry[]; nextToken?: string | null }>(
    LIST_DATABASE_ROW_HISTORY,
    { databaseId, workspaceId, limit, nextToken: nextToken ?? null },
    "listDatabaseRowHistory",
  );
  return {
    items: conn?.items ?? [],
    nextToken: conn?.nextToken ?? null,
  };
}

export async function restorePageVersionApi(input: {
  pageId: string;
  workspaceId: string;
  historyId: string;
}): Promise<GqlPage> {
  return gqlRequired<GqlPage>(RESTORE_PAGE_VERSION, { input }, "restorePageVersion");
}

export async function savePageVersionApi(
  pageId: string,
  workspaceId: string,
): Promise<GqlPage> {
  return gqlRequired<GqlPage>(SAVE_PAGE_VERSION, { pageId, workspaceId }, "savePageVersion");
}

export async function deletePageHistoryEventsApi(
  pageId: string,
  workspaceId: string,
  historyIds: string[],
): Promise<boolean> {
  const ok = await gqlOptional<boolean>(
    DELETE_PAGE_HISTORY_EVENTS,
    { pageId, workspaceId, historyIds },
    "deletePageHistoryEvents",
  );
  return Boolean(ok);
}
