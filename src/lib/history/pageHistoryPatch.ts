import type { GqlPageHistoryEntry } from "../sync/graphql/operations";
import type { PageSnapshot } from "../../types/history";
import { createHistoryPatchEngine } from "./historyPatchEngine";

const pageHistoryPatchEngine = createHistoryPatchEngine<GqlPageHistoryEntry, PageSnapshot>({
  cacheKey: "quicknote.pageHistoryPreview.v1",
});

export function buildPageHistorySnapshotMap(
  entries: GqlPageHistoryEntry[],
  pageId: string,
  workspaceId: string,
): Map<string, PageSnapshot> {
  return pageHistoryPatchEngine.buildSnapshotMap(entries, pageId, workspaceId);
}

export function getPreviousPageHistorySnapshot(
  entries: GqlPageHistoryEntry[],
  pageId: string,
  workspaceId: string,
  historyId: string,
): PageSnapshot | null {
  return pageHistoryPatchEngine.getPreviousSnapshot(entries, pageId, workspaceId, historyId);
}
