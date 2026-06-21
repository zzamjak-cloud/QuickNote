// 원격(GraphQL) 변경을 로컬 zustand 스토어에 LWW 로 적용한다.
// - GraphQL 쪽은 ISO 문자열, 로컬 스토어는 epoch ms(number) — 경계에서 변환.
// - tombstone(deletedAt != null) 이면 로컬에서 제거.
// - 로컬이 더 신선하면 무시(LWW).

import type {
  GqlPage,
  GqlDatabase,
} from "./graphql/operations";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { isProtectedDatabaseId } from "../scheduler/database";
import { applyRemotePagesToStore } from "./storeApply/pageApply";
import { applyRemoteDatabasesToStore } from "./storeApply/databaseApply";

// 공유 가드·캐시 워크스페이스 해석 sink 에서 re-export.
export { shouldApplyRemoteSnapshot } from "./storeApply/applyShared";
// page 도메인 reducer re-export.
export {
  applyRemotePageToStoreCrossWorkspaceAware,
  applyRemotePageToStore,
  applyRemotePagesToStore,
  applyRemotePageMetasToStore,
} from "./storeApply/pageApply";
// database 도메인 reducer re-export.
export {
  applyRemoteDatabaseToStore,
  applyRemoteDatabasesToStore,
} from "./storeApply/databaseApply";

/**
 * LC 스케줄러 워크스페이스의 증분(delta) 스냅샷을 적용한다.
 *
 * 과거에는 "전체 살아있는 목록을 받아 그에 없는 로컬 행을 prune" 했으나, 이는 scoped/부분 로딩
 * (필터 단위·범위 단위로만 가져오는 효율적 방향)과 양립하지 않는다. 부분만 로드한 상태에서
 * "로드 안 된 것을 삭제"하면 서버에 멀쩡히 살아있는 행이 사라진다.
 *
 * 따라서 absence 기반 prune 을 제거하고 적용만 수행한다. 삭제 반영은:
 *  - delta 의 deletedAt 전파(applyRemotePagesToStore 가 삭제 처리),
 *  - 실시간 구독(onPageChanged),
 *  - scoped 조회(fetchScheduleRange / listDatabaseRows)가 살아있는 행만 반환
 * 로 보장된다.
 */
export function reconcileLCSchedulerRemoteSnapshot(args: {
  pages: Array<GqlPage | null | undefined>;
  databases: Array<GqlDatabase | null | undefined>;
}): { prunedPageIds: string[] } {
  applyRemoteDatabasesToStore(args.databases);
  applyRemotePagesToStore(args.pages);
  return { prunedPageIds: [] };
}

// 원격 Comment LWW 적용 reducer 는 ./storeApply/commentApply 로 분리됨.

/**
 * Bootstrap 전체 워크스페이스 페치 직후 호출하는 set-reconciliation.
 *
 * 목적: 서버에서 영구히 사라진(`permanentlyDelete` 또는 row 자체 purge) 데이터베이스 / 페이지가
 * 로컬 캐시에 좀비로 남아있는 현상을 청소한다.
 *
 * 규칙:
 * 1) `remoteIds` 에 있는 id 는 이미 `applyRemote*` 가 처리했으므로 건드리지 않는다.
 * 2) `pendingUpsertIds` 에 있는 id (아직 outbox 에 업로드 대기 중)는 보호.
 * 3) 위 둘 모두에 해당하지 않으면서 같은 워크스페이스에 속하면 → 로컬에서 제거.
 * 4) LC 스케줄러 / 다른 워크스페이스 / 로컬 전용 id 는 건드리지 않는다.
 */
export function reconcileWorkspaceFullSnapshot(args: {
  workspaceId: string;
  remotePageIds: Set<string>;
  remoteDatabaseIds: Set<string>;
  pendingUpsertPageIds: Set<string>;
  pendingUpsertDatabaseIds: Set<string>;
}): { removedPageIds: string[]; removedDatabaseIds: string[] } {
  const {
    workspaceId,
    remotePageIds,
    remoteDatabaseIds,
    pendingUpsertPageIds,
    pendingUpsertDatabaseIds,
  } = args;
  const removedPageIds: string[] = [];
  const removedDatabaseIds: string[] = [];

  if (!workspaceId) return { removedPageIds, removedDatabaseIds };

  // -------- 페이지 reconciliation --------
  usePageStore.setState((s) => {
    if (s.cacheWorkspaceId && s.cacheWorkspaceId !== workspaceId) return s;
    let nextPages = s.pages;
    let nextActive = s.activePageId;
    let changed = false;
    const ensureCopy = () => {
      if (nextPages === s.pages) nextPages = { ...s.pages };
    };

    for (const [pageId, page] of Object.entries(s.pages)) {
      if (!page) continue;
      // LC 스케줄러·마일스톤·피처 DB 영역은 별도 흐름이므로 보호.
      if (page.databaseId && isProtectedDatabaseId(page.databaseId)) continue;
      const pageWs = page.workspaceId;
      // 페이지가 다른 워크스페이스 또는 미지정이면 건드리지 않음.
      if (pageWs && pageWs !== workspaceId) continue;
      if (remotePageIds.has(pageId)) continue;
      if (pendingUpsertPageIds.has(pageId)) continue;
      // 서버에도 없고 outbox 에도 없음 → 좀비. 제거.
      ensureCopy();
      delete nextPages[pageId];
      if (nextActive === pageId) nextActive = null;
      removedPageIds.push(pageId);
      changed = true;
    }
    if (!changed) return s;
    return { ...s, pages: nextPages, activePageId: nextActive };
  });

  // -------- 데이터베이스 reconciliation --------
  useDatabaseStore.setState((s) => {
    if (s.cacheWorkspaceId && s.cacheWorkspaceId !== workspaceId) return s;
    let next = s.databases;
    let changed = false;
    const ensureCopy = () => {
      if (next === s.databases) next = { ...s.databases };
    };

    for (const [dbId, bundle] of Object.entries(s.databases)) {
      if (!bundle) continue;
      // LC 스케줄러·마일스톤·피처 DB 는 별도 흐름.
      if (isProtectedDatabaseId(dbId)) continue;
      const bundleWs = bundle.meta.workspaceId;
      if (bundleWs && bundleWs !== workspaceId) continue;
      if (remoteDatabaseIds.has(dbId)) continue;
      if (pendingUpsertDatabaseIds.has(dbId)) continue;
      ensureCopy();
      delete next[dbId];
      removedDatabaseIds.push(dbId);
      changed = true;
    }
    if (!changed) return s;
    return { ...s, databases: next };
  });

  if (removedPageIds.length > 0 || removedDatabaseIds.length > 0) {
    console.info("[sync] reconcile pruned orphans", {
      workspaceId,
      pages: removedPageIds.length,
      databases: removedDatabaseIds.length,
    });
  }

  return { removedPageIds, removedDatabaseIds };
}
