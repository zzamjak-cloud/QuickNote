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
 * 페이지 좀비 정리(prune). 전체 페이지 목록(`remotePageIds`)이 권위 있을 때만 호출해야 한다.
 * (메타 페이지네이션 등 부분 목록으로 호출하면 멀쩡한 페이지를 지운다.)
 */
export function reconcileWorkspacePagesFullSnapshot(args: {
  workspaceId: string;
  remotePageIds: Set<string>;
  pendingUpsertPageIds: Set<string>;
}): { removedPageIds: string[] } {
  const { workspaceId, remotePageIds, pendingUpsertPageIds } = args;
  const removedPageIds: string[] = [];
  if (!workspaceId) return { removedPageIds };

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

  if (removedPageIds.length > 0) {
    console.info("[sync] reconcile pruned orphan pages", {
      workspaceId,
      pages: removedPageIds.length,
    });
  }
  return { removedPageIds };
}

/**
 * 데이터베이스 좀비 정리(prune). DB 목록은 워크스페이스당 소수라 delta 동기화에서도
 * 항상 전체 조회가 가능하므로, 전체 DB 목록(`remoteDatabaseIds`)을 받으면 페이지와 달리
 * 증분 경로에서도 안전하게 prune 할 수 있다.
 *
 * 규칙:
 * 1) `remoteDatabaseIds` 에 있으면 서버에 살아있음 → 보존.
 * 2) `pendingUpsertDatabaseIds` (outbox 업로드 대기) → 보존.
 * 3) LC 스케줄러·보호 DB / 다른 워크스페이스 DB → 보존.
 * 4) 위에 모두 해당 없으면 서버에서 사라진 좀비 → 로컬 DB + 템플릿 + 그 DB 의 행 페이지 제거.
 *    (행 페이지는 부모 DB 가 서버에 없으므로 함께 좀비로 확정된다.)
 */
export function reconcileWorkspaceDatabasesFullSnapshot(args: {
  workspaceId: string;
  remoteDatabaseIds: Set<string>;
  pendingUpsertDatabaseIds: Set<string>;
}): { removedDatabaseIds: string[]; removedRowPageIds: string[] } {
  const { workspaceId, remoteDatabaseIds, pendingUpsertDatabaseIds } = args;
  const removedDatabaseIds: string[] = [];
  const removedRowPageIds: string[] = [];
  if (!workspaceId) return { removedDatabaseIds, removedRowPageIds };

  useDatabaseStore.setState((s) => {
    if (s.cacheWorkspaceId && s.cacheWorkspaceId !== workspaceId) return s;
    let next = s.databases;
    let nextTemplates = s.dbTemplates;
    let changed = false;
    const ensureCopy = () => {
      if (next === s.databases) next = { ...s.databases };
    };
    const ensureTemplatesCopy = () => {
      if (nextTemplates === s.dbTemplates) nextTemplates = { ...s.dbTemplates };
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
      if (nextTemplates[dbId]) {
        ensureTemplatesCopy();
        delete nextTemplates[dbId];
      }
      removedDatabaseIds.push(dbId);
      changed = true;
    }
    if (!changed) return s;
    return { ...s, databases: next, dbTemplates: nextTemplates };
  });

  // 제거된 DB 의 행 페이지도 함께 정리(부모 DB 가 서버에 없으니 좀비 확정).
  if (removedDatabaseIds.length > 0) {
    const removedDbIdSet = new Set(removedDatabaseIds);
    usePageStore.setState((s) => {
      let nextPages = s.pages;
      let nextActive = s.activePageId;
      let changed = false;
      const ensureCopy = () => {
        if (nextPages === s.pages) nextPages = { ...s.pages };
      };
      for (const [pageId, page] of Object.entries(s.pages)) {
        if (!page?.databaseId || !removedDbIdSet.has(page.databaseId)) continue;
        ensureCopy();
        delete nextPages[pageId];
        if (nextActive === pageId) nextActive = null;
        removedRowPageIds.push(pageId);
        changed = true;
      }
      if (!changed) return s;
      return { ...s, pages: nextPages, activePageId: nextActive };
    });
  }

  if (removedDatabaseIds.length > 0) {
    console.info("[sync] reconcile pruned orphan databases", {
      workspaceId,
      databases: removedDatabaseIds.length,
      rowPages: removedRowPageIds.length,
    });
  }
  return { removedDatabaseIds, removedRowPageIds };
}

