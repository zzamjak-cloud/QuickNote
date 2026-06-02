import { appsyncClient } from "./graphql/client";
import {
  DELETE_DATABASE_HISTORY_EVENTS,
  LIST_DATABASE_HISTORY,
  RESTORE_DATABASE_VERSION,
  type GqlDatabase,
  type GqlDatabaseHistoryEntry,
} from "./graphql/operations";

export async function listDatabaseHistoryApi(
  databaseId: string,
  workspaceId: string,
  limit = 100,
): Promise<GqlDatabaseHistoryEntry[]> {
  const res = (await appsyncClient().graphql({
    query: LIST_DATABASE_HISTORY,
    variables: { databaseId, workspaceId, limit },
  })) as { data?: { listDatabaseHistory?: GqlDatabaseHistoryEntry[] } };
  return res.data?.listDatabaseHistory ?? [];
}

export async function restoreDatabaseVersionApi(input: {
  databaseId: string;
  workspaceId: string;
  historyId: string;
}): Promise<GqlDatabase> {
  const res = (await appsyncClient().graphql({
    query: RESTORE_DATABASE_VERSION,
    variables: { input },
  })) as { data?: { restoreDatabaseVersion?: GqlDatabase } };
  if (!res.data?.restoreDatabaseVersion) throw new Error("restoreDatabaseVersion 응답 없음");
  return res.data.restoreDatabaseVersion;
}

export async function deleteDatabaseHistoryEventsApi(
  databaseId: string,
  workspaceId: string,
  historyIds: string[],
): Promise<boolean> {
  const res = (await appsyncClient().graphql({
    query: DELETE_DATABASE_HISTORY_EVENTS,
    variables: { databaseId, workspaceId, historyIds },
  })) as { data?: { deleteDatabaseHistoryEvents?: boolean } };
  return Boolean(res.data?.deleteDatabaseHistoryEvents);
}
