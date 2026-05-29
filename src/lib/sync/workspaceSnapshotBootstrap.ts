import { unstable_batchedUpdates } from "react-dom";
import { useBlockCommentStore } from "../../store/blockCommentStore";
import { useUiStore } from "../../store/uiStore";
import { fetchPagesByWorkspace, fetchDatabasesByWorkspace } from "./bootstrap";
import { fetchCommentsByWorkspace } from "./commentApi";
import { getSyncEngine } from "./runtime";
import {
  applyRemotePagesToStore,
  applyRemoteDatabasesToStore,
  applyRemoteCommentsToStore,
  reconcileWorkspaceFullSnapshot,
} from "./storeApply";
import { applyWorkspaceLanding } from "./workspaceLanding";
import {
  clearWorkspaceScopedStores,
  refreshWorkspaceSnapshot,
} from "./workspaceSwitch";

type FetchApplyWorkspaceSnapshotOptions = {
  workspaceId: string;
  cancelled?: () => boolean;
  clearWorkspaceBeforeApply?: boolean;
  clearBlockCommentsBeforeApply?: boolean;
  applyLandingAfterApply?: boolean;
  refreshSnapshotAfterApply?: boolean;
  useBatchedUpdates?: boolean;
  logPrefix?: string;
};

function logFetchFailure(domainLabel: string, reason: unknown, logPrefix?: string): void {
  const prefix = logPrefix ? `${logPrefix} — ` : "";
  console.error(`[sync] ${prefix}${domainLabel} 페치 실패, 기존 캐시 유지`, reason);
}

/** 워크스페이스 원격 스냅샷을 가져와 부분 실패를 보존하면서 로컬 store에 적용한다. */
export async function fetchApplyWorkspaceRemoteSnapshot({
  workspaceId,
  cancelled,
  clearWorkspaceBeforeApply = false,
  clearBlockCommentsBeforeApply = false,
  applyLandingAfterApply = false,
  refreshSnapshotAfterApply = false,
  useBatchedUpdates = false,
  logPrefix,
}: FetchApplyWorkspaceSnapshotOptions): Promise<void> {
  const engine = await getSyncEngine();
  const [[pagesResult, dbsResult, commentsResult], pendingIds] = await Promise.all([
    Promise.allSettled([
      fetchPagesByWorkspace(workspaceId),
      fetchDatabasesByWorkspace(workspaceId),
      fetchCommentsByWorkspace(workspaceId),
    ]),
    engine.getPendingUpsertEntityIds(),
  ]);
  if (cancelled?.()) return;

  const pages = pagesResult.status === "fulfilled" ? pagesResult.value : null;
  const dbs = dbsResult.status === "fulfilled" ? dbsResult.value : null;
  const comments = commentsResult.status === "fulfilled" ? commentsResult.value : null;

  const failedDomains: string[] = [];
  if (pagesResult.status === "rejected") {
    failedDomains.push("pages");
    logFetchFailure("페이지", pagesResult.reason, logPrefix);
  }
  if (dbsResult.status === "rejected") {
    failedDomains.push("databases");
    logFetchFailure("DB", dbsResult.reason, logPrefix);
  }
  if (commentsResult.status === "rejected") {
    failedDomains.push("comments");
    logFetchFailure("댓글", commentsResult.reason, logPrefix);
  }
  useUiStore
    .getState()
    .setSyncPartialFetchFailed(failedDomains.length > 0 ? failedDomains : null);

  const remotePageIds = new Set<string>();
  if (pages) for (const page of pages) if (page?.id) remotePageIds.add(page.id);
  const remoteDatabaseIds = new Set<string>();
  if (dbs) for (const database of dbs) if (database?.id) remoteDatabaseIds.add(database.id);

  const apply = () => {
    if (clearWorkspaceBeforeApply) {
      clearWorkspaceScopedStores(workspaceId);
    }
    if (clearBlockCommentsBeforeApply) {
      useBlockCommentStore.getState().clearMessages();
    }
    if (pages) applyRemotePagesToStore(pages);
    if (dbs) applyRemoteDatabasesToStore(dbs);
    if (comments) applyRemoteCommentsToStore(comments);
    // pages + dbs 모두 성공한 경우에만 좀비 정리 실행한다.
    // 부분 실패 시 빈 집합을 전달하면 유효 캐시까지 삭제될 수 있다.
    if (pages && dbs) {
      reconcileWorkspaceFullSnapshot({
        workspaceId,
        remotePageIds,
        remoteDatabaseIds,
        pendingUpsertPageIds: pendingIds.pages,
        pendingUpsertDatabaseIds: pendingIds.databases,
      });
    }
    if (applyLandingAfterApply) {
      applyWorkspaceLanding(workspaceId);
    }
    if (refreshSnapshotAfterApply) {
      refreshWorkspaceSnapshot(workspaceId);
    }
  };

  if (useBatchedUpdates) {
    unstable_batchedUpdates(apply);
  } else {
    apply();
  }
}
