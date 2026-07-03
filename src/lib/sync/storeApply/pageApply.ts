// 원격 Page/PageMeta 엔티티를 page 스토어에 LWW 적용하는 reducer.
// storeApply.ts 에서 분리(behavior-preserving).
import type {
  GqlPage,
  GqlPageMeta,
} from "../graphql/operations";
import { usePageStore } from "../../../store/pageStore";
import { usePageContentLoadStore } from "../../../store/pageContentLoadStore";
import { useDatabaseRowIndexStore } from "../../../store/databaseRowIndexStore";
import type { Page } from "../../../types/page";
import { useWorkspaceStore } from "../../../store/workspaceStore";
import { enqueueAsync, getSyncEngine } from "../runtime";
import {
  createLocalDeleteGuardChecker,
  shouldIgnoreRemoteAfterLocalDelete,
} from "../localDeleteGuards";
import {
  LC_SCHEDULER_DATABASE_ID,
  isLCSchedulerDatabaseId,
  isLegacyLCSchedulerDatabaseId,
} from "../../scheduler/database";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../scheduler/scope";
import { refreshWorkspaceSnapshot, workspaceHasStructureCache } from "../workspaceSwitch";
import { isPageCollabActive } from "../../collab/pageCollabRegistry";
import { isDeletedSchedulePage } from "../../scheduler/deletedSchedulePages";
import {
  isoToMs,
  isLCSchedulerPage,
  gqlOrderNumber,
  toPageInputPayload,
  shouldApplyRemotePageOverwrite,
  gqlPageToLocalPage,
} from "./helpers";
import { EMPTY_DOC } from "../../../store/pageStore/helpers";
import { shouldApplyRemoteSnapshot, resolveNextCacheWorkspaceId } from "./applyShared";
import {
  reconcileDatabaseRowOrders,
  removePageIdFromDatabaseRowOrder,
  ensurePageInDatabaseRowOrder,
} from "./rowOrder";

function normalizeLCSchedulerPageWorkspace(p: GqlPage): GqlPage {
  if (!isLCSchedulerPage(p)) return p;
  if (isLegacyLCSchedulerDatabaseId(p.databaseId)) {
    if (!p.deletedAt) {
      queueMicrotask(() => {
        enqueueAsync("softDeletePage", {
          id: p.id,
          workspaceId: p.workspaceId,
          updatedAt: new Date().toISOString(),
        });
      });
    }
    return {
      ...p,
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
      deletedAt: p.deletedAt ?? new Date().toISOString(),
    };
  }
  const nextDatabaseId = isLCSchedulerDatabaseId(p.databaseId)
    ? LC_SCHEDULER_DATABASE_ID
    : p.databaseId;
  const repaired = {
    ...p,
    workspaceId: LC_SCHEDULER_WORKSPACE_ID,
    databaseId: nextDatabaseId,
  };
  const changed =
    repaired.workspaceId !== p.workspaceId ||
    repaired.databaseId !== p.databaseId;
  if (!p.deletedAt && changed) {
    queueMicrotask(() => {
      enqueueAsync("upsertPage", toPageInputPayload(repaired));
    });
  }
  return repaired;
}

function shouldApplyRemotePageMetaOverwrite(
  local: Page | undefined,
  p: GqlPageMeta,
): boolean {
  if (!local) return true;
  const remoteMs = isoToMs(p.updatedAt);
  if (remoteMs > local.updatedAt) return true;
  if (remoteMs !== local.updatedAt || local.updatedAt <= 0) return false;
  const remoteParent = p.parentId ?? null;
  const remoteOrder = gqlOrderNumber(p);
  const remoteDb = p.databaseId ?? null;
  const localDb = local.databaseId ?? null;
  return (
    local.parentId !== remoteParent ||
    local.order !== remoteOrder ||
    localDb !== remoteDb
  );
}

function gqlPageMetaToLocalPage(p: GqlPageMeta, local?: Page): Page {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    title: p.title,
    titleColor: typeof p.titleColor === "string" ? p.titleColor : null,
    icon: p.icon ?? null,
    coverImage: typeof p.coverImage === "string" ? p.coverImage : null,
    doc: local?.doc ?? structuredClone(EMPTY_DOC),
    parentId: p.parentId ?? null,
    order: gqlOrderNumber(p),
    databaseId: p.databaseId ?? undefined,
    fullPageDatabaseId: p.fullPageDatabaseId ?? undefined,
    dbCells: local?.dbCells,
    createdByMemberId: p.createdByMemberId ?? undefined,
    lastEditedByMemberId: p.lastEditedByMemberId ?? local?.lastEditedByMemberId,
    lastEditedByName: p.lastEditedByName ?? local?.lastEditedByName,
    createdAt: isoToMs(p.createdAt) || Date.now(),
    updatedAt: isoToMs(p.updatedAt) || Date.now(),
    contentLoaded: local?.contentLoaded === true ? true : false,
  };
}

/**
 * 협업 세션이 열린 페이지의 본문(doc) 권위는 Y.Doc/materialize 다. 원격 page.doc echo(REST)가
 * 라이브 편집분을 옛 내용으로 덮지 않도록, 본문이 로드된 활성 협업 페이지는 doc 을 로컬 값으로
 * 보존하고 메타(title/icon/order 등)만 원격을 반영한다. (초기 하이드레이션 = local 없음/meta-only,
 * 세션 비활성 = 정상 적용.)
 */
function preserveCollabDoc(
  merged: Page,
  local: Page | undefined,
  localIsMetaOnly: boolean,
): Page {
  if (local && !localIsMetaOnly && isPageCollabActive(merged.id)) {
    if (isPlaceholderPageDoc(local.doc) && !isPlaceholderPageDoc(merged.doc)) {
      return merged;
    }
    return { ...merged, doc: local.doc, updatedAt: local.updatedAt };
  }
  return merged;
}

function isPlaceholderPageDoc(doc: Page["doc"] | null | undefined): boolean {
  const content = doc?.content;
  if (!Array.isArray(content) || content.length === 0) return true;
  return content.every((node) => {
    if (node?.type !== "paragraph") return false;
    return !Array.isArray(node.content) || node.content.length === 0;
  });
}

// 명시적 cross-workspace 페이지 적재(미리보기 peek·collab 시드·타 워크스페이스 인라인 DB 행 등)용.
// shouldApplyRemoteSnapshot 가드는 subscription 레이스로 인한 타 워크스페이스 오염 방지가 목적이라 유지하되,
// 호출처가 의도적으로 다른 워크스페이스 페이지를 적재할 때는 가드 우회로 직접 store 에 넣는다(불필요한 경고 제거).
// workspaceId 가 현재와 달라 사이드바·동기화 대상에선 자동 제외된다.
export function applyRemotePageToStoreCrossWorkspaceAware(
  remotePage: GqlPage | null | undefined,
): void {
  if (!remotePage) return;
  const current = useWorkspaceStore.getState().currentWorkspaceId;
  if (
    remotePage.workspaceId &&
    remotePage.workspaceId !== current &&
    remotePage.workspaceId !== LC_SCHEDULER_WORKSPACE_ID
  ) {
    const local = gqlPageToLocalPage(remotePage);
    usePageStore.setState((s) => ({
      pages: { ...s.pages, [local.id]: { ...s.pages[local.id], ...local } },
    }));
    return;
  }
  applyRemotePageToStore(remotePage);
}

export function applyRemotePageToStore(
  remotePage: GqlPage | null | undefined,
): void {
  if (!remotePage) return;
  const p = normalizeLCSchedulerPageWorkspace(remotePage);
  if (!shouldApplyRemoteSnapshot(p.workspaceId)) return;
  if (
    !p.deletedAt &&
    shouldIgnoreRemoteAfterLocalDelete("page", p.id, p.workspaceId, p.updatedAt)
  ) {
    if (p.databaseId) removePageIdFromDatabaseRowOrder(p.databaseId, p.id);
    return;
  }
  if (
    p.workspaceId === LC_SCHEDULER_WORKSPACE_ID &&
    !p.deletedAt &&
    p.databaseId &&
    isLCSchedulerDatabaseId(p.databaseId) &&
    isDeletedSchedulePage(p.id)
  ) {
    removePageIdFromDatabaseRowOrder(p.databaseId, p.id);
    return;
  }
  const deletedDbId = p.deletedAt ? usePageStore.getState().pages[p.id]?.databaseId : null;

  usePageStore.setState((s) => {
    const local = s.pages[p.id];
    const localIsMetaOnly =
      local?.contentLoaded === false ||
      Boolean(usePageContentLoadStore.getState().metaOnlyByPageId[p.id]);
    const nextCacheWorkspaceId = resolveNextCacheWorkspaceId(s.cacheWorkspaceId, p.workspaceId);
    if (p.deletedAt) {
      if (!local) return s;
      const rest = { ...s.pages };
      delete rest[p.id];
      let nextActive = s.activePageId;
      if (s.activePageId === p.id) nextActive = null;
      return {
        ...s,
        pages: rest,
        activePageId: nextActive,
        cacheWorkspaceId: nextCacheWorkspaceId,
      };
    }
    if (local && !localIsMetaOnly && !shouldApplyRemotePageOverwrite(local, p)) {
      return s.cacheWorkspaceId === nextCacheWorkspaceId
        ? s
        : { ...s, cacheWorkspaceId: nextCacheWorkspaceId };
    }

    const merged = preserveCollabDoc(gqlPageToLocalPage(p), local, localIsMetaOnly);
    return {
      ...s,
      pages: { ...s.pages, [p.id]: merged },
      cacheWorkspaceId: nextCacheWorkspaceId,
    };
  });

  if (p.deletedAt) {
    usePageContentLoadStore.getState().markLoaded([p.id]);
    if (deletedDbId) removePageIdFromDatabaseRowOrder(deletedDbId, p.id);
    // row-index 스냅샷에서도 prune. 누락 시 삭제된 행이 fallback 으로 유령 렌더된다
    // (databaseRowSources.ts). local 페이지가 없어도(이미 유령) 스냅샷 잔재를 제거해야 한다.
    void useDatabaseRowIndexStore.getState().removePagesFromAllIndexes([p.id]);
    return;
  }
  usePageContentLoadStore.getState().markLoaded([p.id]);

  const after = usePageStore.getState().pages[p.id];
  if (after?.databaseId) {
    ensurePageInDatabaseRowOrder(after.databaseId, after.id);
  }
}

// 서버가 정상 응답으로 "페이지 없음"(getPage=null)을 반환했을 때의 자기치유.
// 영구삭제(hard delete)는 델타 싱크에 tombstone 이 없어 다른 PC 캐시에 유령 페이지로 남는다
// (soft delete tombstone 을 받기 전에 휴지통 영구삭제가 일어난 경우). 합성 tombstone 으로
// applyRemotePageToStore 의 삭제 경로(스토어·activePageId·rowOrder·row-index 정리)를 재사용한다.
// ⚠ GET_PAGE 계열의 네트워크/인가 오류는 throw 라 여기 닿지 않는다 — null 정상 응답에만 호출할 것.
const SERVER_MISSING_PRUNE_MIN_AGE_MS = 10 * 60 * 1000;

export async function pruneServerMissingPageFromCache(
  pageId: string,
  workspaceId?: string | null,
): Promise<boolean> {
  const local = usePageStore.getState().pages[pageId];
  if (!local) return false;
  // 방금 생성돼 아직 서버(outbox flush)에 닿지 않았을 수 있는 신생 페이지는 오인 삭제하지 않는다.
  const lastTouchedMs = Math.max(local.updatedAt || 0, local.createdAt || 0);
  if (Date.now() - lastTouchedMs < SERVER_MISSING_PRUNE_MIN_AGE_MS) return false;
  // outbox 업로드 대기 중이면 서버 미존재가 정상 과도 상태 — 보류. (조회 실패 시에도 안전하게 보류)
  try {
    const engine = await getSyncEngine();
    const pending = await engine.getPendingUpsertEntityIds();
    if (pending.pages.has(pageId)) return false;
  } catch {
    return false;
  }
  const ws = local.workspaceId ?? workspaceId ?? null;
  if (!ws) return false;
  const nowIso = new Date().toISOString();
  applyRemotePageToStore({
    id: pageId,
    workspaceId: ws,
    title: local.title ?? "",
    deletedAt: nowIso,
    updatedAt: nowIso,
    createdAt: new Date(local.createdAt || Date.now()).toISOString(),
  } as GqlPage);
  const pruned = usePageStore.getState().pages[pageId] === undefined;
  // persist 스냅샷에도 잔재가 남으면 새로고침 시 유령이 부활한다 — 캐시가 있으면 갱신.
  if (pruned && workspaceHasStructureCache(ws)) {
    refreshWorkspaceSnapshot(ws);
  }
  return pruned;
}

export function applyRemotePagesToStore(
  remotePages: Array<GqlPage | null | undefined>,
): void {
  if (remotePages.length === 0) return;
  const nonNullRemotePages = remotePages.filter(
    (remotePage): remotePage is GqlPage => Boolean(remotePage),
  );
  const pages = nonNullRemotePages
    .map(normalizeLCSchedulerPageWorkspace)
    .filter((p) => shouldApplyRemoteSnapshot(p.workspaceId));
  if (pages.length === 0) return;

  const affectedDatabaseIds = new Set<string>();
  const deletedPageIds: string[] = [];
  const shouldIgnoreLocalDelete = createLocalDeleteGuardChecker();

  usePageStore.setState((s) => {
    let nextPages = s.pages;
    let nextActive = s.activePageId;
    let nextCacheWorkspaceId = s.cacheWorkspaceId;
    let changed = false;
    const metaOnlyByPageId = usePageContentLoadStore.getState().metaOnlyByPageId;

    const ensurePagesCopy = () => {
      if (nextPages === s.pages) nextPages = { ...s.pages };
    };

    for (const p of pages) {
      nextCacheWorkspaceId = resolveNextCacheWorkspaceId(nextCacheWorkspaceId, p.workspaceId);

      if (
        !p.deletedAt &&
        shouldIgnoreLocalDelete("page", p.id, p.workspaceId, p.updatedAt)
      ) {
        if (p.databaseId) affectedDatabaseIds.add(p.databaseId);
        continue;
      }

      if (
        p.workspaceId === LC_SCHEDULER_WORKSPACE_ID &&
        !p.deletedAt &&
        p.databaseId &&
        isLCSchedulerDatabaseId(p.databaseId) &&
        isDeletedSchedulePage(p.id)
      ) {
        affectedDatabaseIds.add(p.databaseId);
        continue;
      }

      const local = nextPages[p.id];
      const localIsMetaOnly =
        local?.contentLoaded === false || Boolean(metaOnlyByPageId[p.id]);
      if (p.deletedAt) {
        deletedPageIds.push(p.id);
        if (!local) continue;
        ensurePagesCopy();
        delete nextPages[p.id];
        if (nextActive === p.id) nextActive = null;
        if (local.databaseId) affectedDatabaseIds.add(local.databaseId);
        changed = true;
        continue;
      }

      if (local && !localIsMetaOnly && !shouldApplyRemotePageOverwrite(local, p)) continue;
      const merged = preserveCollabDoc(gqlPageToLocalPage(p), local, localIsMetaOnly);
      ensurePagesCopy();
      nextPages[p.id] = merged;
      if (merged.databaseId) affectedDatabaseIds.add(merged.databaseId);
      changed = true;
    }

    if (
      !changed &&
      nextActive === s.activePageId &&
      nextCacheWorkspaceId === s.cacheWorkspaceId
    ) {
      return s;
    }
    return {
      ...s,
      pages: nextPages,
      activePageId: nextActive,
      cacheWorkspaceId: nextCacheWorkspaceId,
    };
  });

  reconcileDatabaseRowOrders(affectedDatabaseIds);
  // 수신한 soft-delete 페이지를 row-index 스냅샷에서도 prune(유령 행 방지). 멱등·안전.
  if (deletedPageIds.length > 0) {
    void useDatabaseRowIndexStore.getState().removePagesFromAllIndexes(deletedPageIds);
  }
  usePageContentLoadStore.getState().markLoaded(pages.map((page) => page.id));
}

export function applyRemotePageMetasToStore(
  remotePageMetas: Array<GqlPageMeta | null | undefined>,
): void {
  if (remotePageMetas.length === 0) return;
  const nonNullPageMetas = remotePageMetas.filter(
    (remotePage): remotePage is GqlPageMeta => Boolean(remotePage),
  );
  const pageMetas = nonNullPageMetas
    .filter((p) => shouldApplyRemoteSnapshot(p.workspaceId));
  if (pageMetas.length === 0) return;

  const metaOnlyIds: string[] = [];
  const loadedIds: string[] = [];
  const deletedPageIds: string[] = [];
  const affectedDatabaseIds = new Set<string>();

  usePageStore.setState((s) => {
    let nextPages = s.pages;
    let nextActive = s.activePageId;
    let nextCacheWorkspaceId = s.cacheWorkspaceId;
    let changed = false;
    const metaOnlyByPageId = usePageContentLoadStore.getState().metaOnlyByPageId;

    const ensurePagesCopy = () => {
      if (nextPages === s.pages) nextPages = { ...s.pages };
    };

    for (const p of pageMetas) {
      nextCacheWorkspaceId = resolveNextCacheWorkspaceId(nextCacheWorkspaceId, p.workspaceId);
      const local = nextPages[p.id];
      if (local?.databaseId) affectedDatabaseIds.add(local.databaseId);
      if (p.databaseId) affectedDatabaseIds.add(p.databaseId);
      if (p.deletedAt) {
        loadedIds.push(p.id);
        deletedPageIds.push(p.id);
        if (!local) continue;
        ensurePagesCopy();
        delete nextPages[p.id];
        if (nextActive === p.id) nextActive = null;
        changed = true;
        continue;
      }

      if (local && !shouldApplyRemotePageMetaOverwrite(local, p)) {
        if (local.contentLoaded === true && metaOnlyByPageId[p.id]) loadedIds.push(p.id);
        continue;
      }
      const merged = gqlPageMetaToLocalPage(p, local);
      ensurePagesCopy();
      nextPages[p.id] = merged;
      if (merged.contentLoaded === false) metaOnlyIds.push(p.id);
      else loadedIds.push(p.id);
      changed = true;
    }

    if (
      !changed &&
      nextActive === s.activePageId &&
      nextCacheWorkspaceId === s.cacheWorkspaceId
    ) {
      return s;
    }
    return {
      ...s,
      pages: nextPages,
      activePageId: nextActive,
      cacheWorkspaceId: nextCacheWorkspaceId,
    };
  });

  reconcileDatabaseRowOrders(affectedDatabaseIds);
  // 수신한 soft-delete 페이지를 row-index 스냅샷에서도 prune(유령 행 방지). 멱등·안전.
  if (deletedPageIds.length > 0) {
    void useDatabaseRowIndexStore.getState().removePagesFromAllIndexes(deletedPageIds);
  }
  if (loadedIds.length > 0) usePageContentLoadStore.getState().markLoaded(loadedIds);
  if (metaOnlyIds.length > 0) usePageContentLoadStore.getState().markMetaOnly(metaOnlyIds);
}
