import { unstable_batchedUpdates } from "react-dom";
import { useBlockCommentStore } from "../../store/blockCommentStore";
import { useUiStore } from "../../store/uiStore";
import {
  fetchDatabasesByWorkspace,
  fetchPageMetasBatch,
  fetchPagesByWorkspace,
} from "./bootstrap";
import { usePageMetaRemoteStore } from "../../store/pageMetaRemoteStore";
import { fetchCommentsByWorkspace } from "./commentApi";
import { getSyncEngine } from "./runtime";
import {
  applyRemotePageMetasToStore,
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
import { useSyncWatermarkStore } from "../../store/syncWatermarkStore";

type FetchApplyWorkspaceSnapshotOptions = {
  workspaceId: string;
  cancelled?: () => boolean;
  clearWorkspaceBeforeApply?: boolean;
  clearBlockCommentsBeforeApply?: boolean;
  applyLandingAfterApply?: boolean;
  /** 워크스페이스 전환 진입 시 true — landing 이 직전 상태를 무시하고 첫 인덱스 페이지로 리셋한다. */
  landingForceFirstRoot?: boolean;
  refreshSnapshotAfterApply?: boolean;
  useBatchedUpdates?: boolean;
  logPrefix?: string;
  /**
   * 지정 시 "증분 모드": 이 시각 이후 변경분만 페치하고 좀비 prune 을 건너뛴다.
   * (부분 스냅샷으로 prune 하면 변경되지 않은 항목이 모두 삭제되므로 절대 prune 하지 않는다.)
   * 전체 prune 이 필요한 복구 경로는 이 값을 비워 전체 모드로 호출해야 한다.
   */
  updatedAfter?: string;
};

/** 항목 배열들에서 최대 updatedAt(ISO) 을 구한다. 없으면 undefined. */
function maxUpdatedAt(
  ...lists: Array<Array<{ updatedAt?: string | null } | null> | null>
): string | undefined {
  let max: string | undefined;
  for (const list of lists) {
    if (!list) continue;
    for (const item of list) {
      const u = item?.updatedAt;
      if (typeof u === "string" && (!max || u > max)) max = u;
    }
  }
  return max;
}

function logFetchFailure(domainLabel: string, reason: unknown, logPrefix?: string): void {
  const prefix = logPrefix ? `${logPrefix} — ` : "";
  console.error(`[sync] ${prefix}${domainLabel} 페치 실패, 기존 캐시 유지`, reason);
}

function errorText(reason: unknown): string {
  if (reason instanceof Error) return `${reason.message}\n${reason.stack ?? ""}`;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

function isPageMetaSchemaUnavailable(reason: unknown): boolean {
  const text = errorText(reason);
  const schemaValidationError =
    text.includes("Cannot query field") ||
    text.includes("Unknown field") ||
    text.includes("Validation error") ||
    text.includes("FieldUndefined");
  return schemaValidationError && text.includes("listPageMetas");
}


/** 워크스페이스 원격 스냅샷을 가져와 부분 실패를 보존하면서 로컬 store에 적용한다. */
export async function fetchApplyWorkspaceRemoteSnapshot({
  workspaceId,
  cancelled,
  clearWorkspaceBeforeApply = false,
  clearBlockCommentsBeforeApply = false,
  applyLandingAfterApply = false,
  landingForceFirstRoot = false,
  refreshSnapshotAfterApply = false,
  useBatchedUpdates = false,
  logPrefix,
  updatedAfter,
}: FetchApplyWorkspaceSnapshotOptions): Promise<void> {
  const isDelta = Boolean(updatedAfter);
  const engine = await getSyncEngine();
  const [[pagesResult, dbsResult, commentsResult], pendingIds] = await Promise.all([
    Promise.allSettled([
      fetchPagesByWorkspace(workspaceId, updatedAfter),
      fetchDatabasesByWorkspace(workspaceId, updatedAfter),
      fetchCommentsByWorkspace(workspaceId, updatedAfter),
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
    if (clearWorkspaceBeforeApply && !isDelta) {
      clearWorkspaceScopedStores(workspaceId);
    }
    if (clearBlockCommentsBeforeApply && !isDelta) {
      useBlockCommentStore.getState().clearMessages();
    }
    if (pages) applyRemotePagesToStore(pages);
    if (!isDelta && pages) {
      usePageMetaRemoteStore.getState().setNextToken(workspaceId, null);
    }
    if (dbs) applyRemoteDatabasesToStore(dbs);
    if (comments) applyRemoteCommentsToStore(comments);
    // 좀비 정리(prune)는 전체 스냅샷에서만 안전하다. 증분 모드에서는 부분 결과만 오므로
    // prune 하면 변경되지 않은 멀쩡한 항목까지 삭제된다 → 절대 prune 하지 않는다.
    // 또한 pages + dbs 모두 성공한 경우에만 실행한다(부분 실패 시 유효 캐시 삭제 방지).
    if (!isDelta && pages && dbs) {
      reconcileWorkspaceFullSnapshot({
        workspaceId,
        remotePageIds,
        remoteDatabaseIds,
        pendingUpsertPageIds: pendingIds.pages,
        pendingUpsertDatabaseIds: pendingIds.databases,
      });
    }
    if (applyLandingAfterApply) {
      applyWorkspaceLanding(workspaceId, { forceFirstRoot: landingForceFirstRoot });
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

  // 모든 도메인이 성공한 경우에만 워터마크를 전진시킨다.
  // (한 도메인이라도 실패하면 그 도메인의 미수신 변경분을 다음 증분에서 놓치지 않도록 보류.)
  if (failedDomains.length === 0) {
    const mx = maxUpdatedAt(pages, dbs, comments);
    if (mx) useSyncWatermarkStore.getState().advance(workspaceId, mx);
  }
}

export async function fetchApplyWorkspaceRemoteMetaSnapshot({
  workspaceId,
  cancelled,
  clearWorkspaceBeforeApply = false,
  clearBlockCommentsBeforeApply = false,
  applyLandingAfterApply = false,
  landingForceFirstRoot = false,
  refreshSnapshotAfterApply = false,
  useBatchedUpdates = false,
  logPrefix,
  updatedAfter,
}: FetchApplyWorkspaceSnapshotOptions): Promise<void> {
  const isDelta = Boolean(updatedAfter);
  const [pageMetasBatchResult, dbsResult, commentsResult] = await Promise.allSettled([
    fetchPageMetasBatch({ workspaceId, updatedAfter }),
    fetchDatabasesByWorkspace(workspaceId, updatedAfter),
    fetchCommentsByWorkspace(workspaceId, updatedAfter),
  ]);
  if (cancelled?.()) return;

  const pageMetasBatch = pageMetasBatchResult.status === "fulfilled" ? pageMetasBatchResult.value : null;
  const dbs = dbsResult.status === "fulfilled" ? dbsResult.value : null;
  const comments = commentsResult.status === "fulfilled" ? commentsResult.value : null;

  const failedDomains: string[] = [];
  if (pageMetasBatchResult.status === "rejected") {
    if (isPageMetaSchemaUnavailable(pageMetasBatchResult.reason)) {
      console.warn("[sync] 페이지 메타 API 미배포, 전체 스냅샷 fallback 대기", {
        workspaceId,
        logPrefix,
      });
    } else {
      failedDomains.push("pageMetas");
      logFetchFailure("페이지 메타", pageMetasBatchResult.reason, logPrefix);
    }
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

  const apply = () => {
    if (clearWorkspaceBeforeApply && !isDelta) {
      clearWorkspaceScopedStores(workspaceId);
    }
    if (clearBlockCommentsBeforeApply && !isDelta) {
      useBlockCommentStore.getState().clearMessages();
    }
    if (pageMetasBatch) {
      applyRemotePageMetasToStore(pageMetasBatch.items);
      usePageMetaRemoteStore.getState().setNextToken(workspaceId, pageMetasBatch.nextToken ?? null);
    }
    if (dbs) applyRemoteDatabasesToStore(dbs);
    if (comments) applyRemoteCommentsToStore(comments);
    if (applyLandingAfterApply) applyWorkspaceLanding(workspaceId, { forceFirstRoot: landingForceFirstRoot });
  };

  if (useBatchedUpdates) {
    unstable_batchedUpdates(apply);
  } else {
    apply();
  }

  if (failedDomains.length === 0) {
    const mx = maxUpdatedAt(pageMetasBatch?.items ?? [], dbs, comments);
    if (mx) useSyncWatermarkStore.getState().advance(workspaceId, mx);
  }

  // 100개 초과 워크스페이스: nextToken 있으면 나머지 페이지 메타를 모두 로드
  if (pageMetasBatch?.nextToken && !cancelled?.()) {
    let nextToken: string | null = pageMetasBatch.nextToken;
    // 서버가 동일 토큰을 반복 반환하면 무한 루프에 빠지므로 본 토큰을 추적해 차단
    const seenTokens = new Set<string>([nextToken]);
    while (nextToken && !cancelled?.()) {
      try {
        const moreBatch = await fetchPageMetasBatch({ workspaceId, nextToken });
        applyRemotePageMetasToStore(moreBatch.items);
        const prevToken: string = nextToken;
        nextToken = moreBatch.nextToken ?? null;
        if (nextToken && (nextToken === prevToken || seenTokens.has(nextToken))) {
          console.warn("[sync] 페이지 메타 nextToken 반복 감지 — 루프 중단", { workspaceId });
          break;
        }
        if (nextToken) seenTokens.add(nextToken);
        usePageMetaRemoteStore.getState().setNextToken(workspaceId, nextToken);
        const mx = maxUpdatedAt(moreBatch.items);
        if (mx) useSyncWatermarkStore.getState().advance(workspaceId, mx);
      } catch (error) {
        console.warn("[sync] 페이지 메타 추가 배치 페치 실패", { workspaceId, error });
        break;
      }
    }
  }

  // 모든 페이지 메타 로드 완료(nextToken 없음) 후 스냅샷 갱신
  const finalToken = usePageMetaRemoteStore.getState().nextTokenByWorkspaceId[workspaceId];
  if (refreshSnapshotAfterApply && pageMetasBatch && !finalToken && !cancelled?.()) {
    refreshWorkspaceSnapshot(workspaceId);
  }
}
