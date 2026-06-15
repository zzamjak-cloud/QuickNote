import { gqlOptional, gqlRequired } from "./graphqlRequest";
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
  const entries = await gqlOptional<GqlDatabaseHistoryEntry[]>(
    LIST_DATABASE_HISTORY,
    { databaseId, workspaceId, limit },
    "listDatabaseHistory",
  );
  return entries ?? [];
}

export async function restoreDatabaseVersionApi(input: {
  databaseId: string;
  workspaceId: string;
  historyId: string;
}): Promise<GqlDatabase> {
  return gqlRequired<GqlDatabase>(
    RESTORE_DATABASE_VERSION,
    { input },
    "restoreDatabaseVersion",
  );
}

export async function deleteDatabaseHistoryEventsApi(
  databaseId: string,
  workspaceId: string,
  historyIds: string[],
): Promise<boolean> {
  const ok = await gqlOptional<boolean>(
    DELETE_DATABASE_HISTORY_EVENTS,
    { databaseId, workspaceId, historyIds },
    "deleteDatabaseHistoryEvents",
  );
  return Boolean(ok);
}
