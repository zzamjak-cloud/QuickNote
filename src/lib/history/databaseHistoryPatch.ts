import type { GqlDatabaseHistoryEntry } from "../sync/graphql/operations";
import { createHistoryPatchEngine } from "./historyPatchEngine";

export type DatabaseHistorySnapshot = {
  id: string;
  workspaceId: string;
  createdByMemberId?: string | null;
  title?: string | null;
  columns?: unknown;
  presets?: unknown | null;
  panelState?: unknown | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  deletedAt?: string | null;
};

const databaseHistoryPatchEngine = createHistoryPatchEngine<
  GqlDatabaseHistoryEntry,
  DatabaseHistorySnapshot
>({
  cacheKey: "quicknote.databaseHistoryPreview.v1",
});

export function buildDatabaseHistorySnapshotMap(
  entries: GqlDatabaseHistoryEntry[],
  databaseId: string,
  workspaceId: string,
): Map<string, DatabaseHistorySnapshot> {
  return databaseHistoryPatchEngine.buildSnapshotMap(entries, databaseId, workspaceId);
}

export function getPreviousDatabaseHistorySnapshot(
  entries: GqlDatabaseHistoryEntry[],
  databaseId: string,
  workspaceId: string,
  historyId: string,
): DatabaseHistorySnapshot | null {
  return databaseHistoryPatchEngine.getPreviousSnapshot(entries, databaseId, workspaceId, historyId);
}
