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
  // 행 멤버십 — 히스토리 스냅샷에만 존재(Database 레코드엔 비저장). 행 추가/삭제 프리뷰용.
  rowPageOrder?: string[] | null;
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
