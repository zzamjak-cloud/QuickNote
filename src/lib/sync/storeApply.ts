// 원격(GraphQL) 변경을 로컬 zustand 스토어에 LWW 로 적용한다.
// - GraphQL 쪽은 ISO 문자열, 로컬 스토어는 epoch ms(number) — 경계에서 변환.
// - tombstone(deletedAt != null) 이면 로컬에서 제거.
// - 로컬이 더 신선하면 무시(LWW).

import type {
  GqlPage,
  GqlPageMeta,
  GqlDatabase,
} from "./graphql/operations";
import type { GqlComment } from "./queries/comment";
import { usePageStore } from "../../store/pageStore";
import { usePageContentLoadStore } from "../../store/pageContentLoadStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useBlockCommentStore } from "../../store/blockCommentStore";
import type { Page } from "../../types/page";
import type { CellValue, DatabaseBundle, DatabasePanelState, DatabaseTemplate } from "../../types/database";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { repairDbHistoryBaselineIfNeeded } from "../../store/historyStore";
import type { BlockCommentMsg } from "../../types/blockComment";
import { enqueueAsync } from "./runtime";
import {
  createLocalDeleteGuardChecker,
  shouldIgnoreRemoteAfterLocalDelete,
} from "./localDeleteGuards";
import {
  LC_SCHEDULER_DATABASE_ID,
  LC_SCHEDULER_DATABASE_TITLE,
  isLCSchedulerDatabaseId,
  isLegacyLCSchedulerDatabaseId,
  isProtectedDatabaseId,
} from "../scheduler/database";
import { LC_SCHEDULER_WORKSPACE_ID } from "../scheduler/scope";
import {
  tryParseSerializedColumns,
  tryParseSerializedPanelState,
  tryParseSerializedPresets,
} from "../database/schema/normalizeDatabase";
import { normalizeTemplateAutomationConfig } from "../database/templateAutomation";
import { isDeletedSchedulePage } from "../scheduler/deletedSchedulePages";

/**
 * 구독 레이스·백엔드 오류로 다른 워크스페이스 스냅샷이 내려올 때 로컬 캐시가 오염되지 않게 한다.
 */
function shouldApplyRemoteSnapshot(remoteWorkspaceId: string | null | undefined): boolean {
  if (remoteWorkspaceId == null || remoteWorkspaceId === "") {
    console.warn("[sync] storeApply: workspaceId 없는 원격 항목은 적용하지 않음");
    return false;
  }
  // LC 스케줄러는 공용 워크스페이스이므로 현재 선택 워크스페이스와 무관하게 반영한다.
  if (remoteWorkspaceId === LC_SCHEDULER_WORKSPACE_ID) return true;
  const current = useWorkspaceStore.getState().currentWorkspaceId;
  if (!current) return true;
  if (current !== remoteWorkspaceId) {
    console.warn("[sync] storeApply: 현재 워크스페이스와 다른 원격 데이터 무시", {
      currentWorkspaceId: current,
      remoteWorkspaceId,
    });
    return false;
  }
  return true;
}

function resolveNextCacheWorkspaceId(
  current: string | null,
  remoteWorkspaceId: string,
): string | null {
  return remoteWorkspaceId === LC_SCHEDULER_WORKSPACE_ID ? current : remoteWorkspaceId;
}


import {
  isoToMs,
  parseAwsJson,
  isRemoteNewer,
  isLCSchedulerPage,
  gqlOrderNumber,
  stringArrayEqual,
  toPageInputPayload,
  shouldApplyRemotePageOverwrite,
  gqlPageToLocalPage,
  mergeRowPageOrderWithDerived,
} from "./storeApply/helpers";
import { EMPTY_DOC } from "../../store/pageStore/helpers";

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

/** AppSync Database 모델에는 rowPageOrder 가 없으므로, 페이지 스토어에서 역추적한다.
 *  _qn_isTemplate 마커가 있는 페이지는 템플릿이므로 행 목록에서 제외한다. */
function collectRowPageIdsForDatabase(databaseId: string): string[] {
  const pages = usePageStore.getState().pages;
  return Object.values(pages)
    .filter(
      (page) =>
        page.databaseId === databaseId &&
        page.dbCells?.["_qn_isTemplate"] !== "1",
    )
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((page) => page.id);
}

function collectRowPageIdsForDatabases(databaseIds: Set<string>): Map<string, string[]> {
  const out = new Map<string, Page[]>();
  for (const id of databaseIds) out.set(id, []);
  if (out.size === 0) return new Map();
  const pages = usePageStore.getState().pages;
  for (const page of Object.values(pages)) {
    if (!page.databaseId || !databaseIds.has(page.databaseId)) continue;
    if (page.dbCells?.["_qn_isTemplate"] === "1") continue;
    out.get(page.databaseId)?.push(page);
  }
  const sorted = new Map<string, string[]>();
  for (const [databaseId, pagesForDb] of out) {
    sorted.set(
      databaseId,
      pagesForDb
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
        .map((page) => page.id),
    );
  }
  return sorted;
}

function reconcileDatabaseRowOrders(databaseIds: Set<string>): void {
  if (databaseIds.size === 0) return;
  const derivedByDbId = collectRowPageIdsForDatabases(databaseIds);
  useDatabaseStore.setState((s) => {
    let databases = s.databases;
    let changed = false;
    for (const databaseId of databaseIds) {
      const db = databases[databaseId];
      if (!db) continue;
      const derived = derivedByDbId.get(databaseId) ?? [];
      const rowPageOrder = mergeRowPageOrderWithDerived(db.rowPageOrder, derived);
      if (stringArrayEqual(db.rowPageOrder, rowPageOrder)) continue;
      if (!changed) databases = { ...s.databases };
      changed = true;
      databases[databaseId] = { ...db, rowPageOrder };
    }
    return changed ? { ...s, databases } : s;
  });
}

function removePageIdFromDatabaseRowOrder(databaseId: string, pageId: string): void {
  useDatabaseStore.setState((s) => {
    const db = s.databases[databaseId];
    if (!db || !db.rowPageOrder.includes(pageId)) return s;
    return {
      ...s,
      databases: {
        ...s.databases,
        [databaseId]: {
          ...db,
          rowPageOrder: db.rowPageOrder.filter((id) => id !== pageId),
        },
      },
    };
  });
}


/** 구독 순서상 DB 스냅샷보다 행 페이지가 먼저 올 때 rowPageOrder 에 id 가 빠지지 않게 한다.
 *  템플릿 페이지(_qn_isTemplate)는 rowPageOrder 에 추가하지 않는다. */
function ensurePageInDatabaseRowOrder(databaseId: string, pageId: string): void {
  const page = usePageStore.getState().pages[pageId];
  if (page?.dbCells?.["_qn_isTemplate"] === "1") return;
  useDatabaseStore.setState((s) => {
    const db = s.databases[databaseId];
    if (!db || db.rowPageOrder.includes(pageId)) return s;
    return {
      ...s,
      databases: {
        ...s.databases,
        [databaseId]: {
          ...db,
          rowPageOrder: [...db.rowPageOrder, pageId],
        },
      },
    };
  });
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

    const merged = gqlPageToLocalPage(p);
    return {
      ...s,
      pages: { ...s.pages, [p.id]: merged },
      cacheWorkspaceId: nextCacheWorkspaceId,
    };
  });

  if (p.deletedAt) {
    usePageContentLoadStore.getState().markLoaded([p.id]);
    if (deletedDbId) removePageIdFromDatabaseRowOrder(deletedDbId, p.id);
    return;
  }
  usePageContentLoadStore.getState().markLoaded([p.id]);

  const after = usePageStore.getState().pages[p.id];
  if (after?.databaseId) {
    ensurePageInDatabaseRowOrder(after.databaseId, after.id);
  }
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
        if (!local) continue;
        ensurePagesCopy();
        delete nextPages[p.id];
        if (nextActive === p.id) nextActive = null;
        if (local.databaseId) affectedDatabaseIds.add(local.databaseId);
        changed = true;
        continue;
      }

      if (local && !localIsMetaOnly && !shouldApplyRemotePageOverwrite(local, p)) continue;
      const merged = gqlPageToLocalPage(p);
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
        if (!local) continue;
        ensurePagesCopy();
        delete nextPages[p.id];
        if (nextActive === p.id) nextActive = null;
        changed = true;
        continue;
      }

      if (local && !shouldApplyRemotePageMetaOverwrite(local, p)) continue;
      const merged = gqlPageMetaToLocalPage(p, local);
      ensurePagesCopy();
      nextPages[p.id] = merged;
      if (merged.contentLoaded === false || metaOnlyByPageId[p.id]) metaOnlyIds.push(p.id);
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
  if (loadedIds.length > 0) usePageContentLoadStore.getState().markLoaded(loadedIds);
  if (metaOnlyIds.length > 0) usePageContentLoadStore.getState().markMetaOnly(metaOnlyIds);
}

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

// 페이지 댓글 sentinel (PageCommentBar 와 동일 값 유지)
const PAGE_COMMENT_SENTINEL = "__page__";

/** blockId/pageId 유효성 검사 — 빈 문자열·whitespace 는 거부 */
function isValidCommentId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.trim().length > 0;
}

/** 원격 Comment 엔티티를 blockCommentStore 에 LWW 적용 */
export function applyRemoteCommentToStore(
  c: GqlComment | null | undefined,
): void {
  if (!c) return;
  if (!shouldApplyRemoteSnapshot(c.workspaceId)) return;

  // 손상된 페이로드 방어: pageId 와 blockId 가 유효해야 적용
  if (!isValidCommentId(c.pageId)) {
    console.warn("[sync] applyRemoteCommentToStore: pageId 누락 — 무시", c.id);
    return;
  }
  if (!isValidCommentId(c.blockId) && c.blockId !== PAGE_COMMENT_SENTINEL) {
    console.warn("[sync] applyRemoteCommentToStore: blockId 누락 — 무시", c.id);
    return;
  }

  const mentionMemberIds = parseAwsJson<string[]>(c.mentionMemberIds, []);

  if (c.deletedAt) {
    useBlockCommentStore.getState().removeMessage(c.id);
    return;
  }

  const msg: BlockCommentMsg = {
    id: c.id,
    workspaceId: c.workspaceId,
    pageId: c.pageId,
    blockId: c.blockId,
    authorMemberId: c.authorMemberId,
    bodyText: c.bodyText,
    mentionMemberIds,
    parentId: c.parentId ?? null,
    createdAt: isoToMs(c.createdAt) || Date.now(),
  };

  useBlockCommentStore.getState().applyRemoteMessage(msg);
}

export function applyRemoteCommentsToStore(
  comments: Array<GqlComment | null | undefined>,
): void {
  if (comments.length === 0) return;
  const upserts: BlockCommentMsg[] = [];
  const deletes = new Set<string>();

  for (const c of comments) {
    if (!c) continue;
    if (!shouldApplyRemoteSnapshot(c.workspaceId)) continue;
    if (!isValidCommentId(c.pageId)) {
      console.warn("[sync] applyRemoteCommentsToStore: pageId 누락 — 무시", c.id);
      continue;
    }
    if (!isValidCommentId(c.blockId) && c.blockId !== PAGE_COMMENT_SENTINEL) {
      console.warn("[sync] applyRemoteCommentsToStore: blockId 누락 — 무시", c.id);
      continue;
    }
    if (c.deletedAt) {
      deletes.add(c.id);
      continue;
    }
    upserts.push({
      id: c.id,
      workspaceId: c.workspaceId,
      pageId: c.pageId,
      blockId: c.blockId,
      authorMemberId: c.authorMemberId,
      bodyText: c.bodyText,
      mentionMemberIds: parseAwsJson<string[]>(c.mentionMemberIds, []),
      parentId: c.parentId ?? null,
      createdAt: isoToMs(c.createdAt) || Date.now(),
    });
  }

  if (upserts.length === 0 && deletes.size === 0) return;

  useBlockCommentStore.setState((s) => {
    const byId = new Map(s.messages.map((message) => [message.id, message]));
    for (const id of deletes) byId.delete(id);
    for (const msg of upserts) byId.set(msg.id, msg);
    const messages = Array.from(byId.values());
    if (messages.length === s.messages.length) {
      let same = true;
      for (let i = 0; i < messages.length; i += 1) {
        if (messages[i] !== s.messages[i]) {
          same = false;
          break;
        }
      }
      if (same) return s;
    }
    return { ...s, messages };
  });
}

function parseRemoteDatabaseSchema(
  db: GqlDatabase,
): (Pick<DatabaseBundle, "columns" | "presets" | "panelState"> & {
  templates?: DatabaseTemplate[];
}) | null {
  const columns = tryParseSerializedColumns(db.columns);
  const presets = tryParseSerializedPresets(db.presets);
  const panelState = tryParseSerializedPanelState(db.panelState);
  const templates = parseRemoteDatabaseTemplates(db.templates);
  if (!columns || !presets) {
    console.warn("[sync] storeApply: invalid database schema ignored", {
      databaseId: db.id,
      columnsOk: Boolean(columns),
      presetsOk: Boolean(presets),
      rawColumns: db.columns,
      rawPresets: db.presets,
    });
    return null;
  }
  if (db.panelState != null && !panelState) {
    console.warn("[sync] storeApply: invalid database panelState ignored", {
      databaseId: db.id,
    });
  }
  return {
    columns,
    presets,
    ...(panelState ? { panelState } : {}),
    ...(templates !== undefined ? { templates } : {}),
  };
}

function parseRemoteDatabaseTemplates(raw: unknown): DatabaseTemplate[] | undefined {
  if (raw == null || raw === "") return undefined;
  let parsed: unknown = raw;
  for (let depth = 0; depth < 2 && typeof parsed === "string"; depth += 1) {
    if (parsed === "") return undefined;
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(parsed)) {
    return undefined;
  }
  const templates: DatabaseTemplate[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.title !== "string") continue;
    const cells =
      record.cells && typeof record.cells === "object" && !Array.isArray(record.cells)
        ? (record.cells as Record<string, CellValue>)
        : {};
    const automation = normalizeTemplateAutomationConfig(record.automation, `${record.id}:automation`);
    templates.push({
      id: record.id,
      title: record.title,
      cells,
      ...(typeof record.pageId === "string" ? { pageId: record.pageId } : {}),
      ...(automation ? { automation } : {}),
    });
  }
  return templates;
}

function mergeRemoteSchedulerMemberOrder(
  localPanelState: DatabasePanelState | undefined,
  remotePanelState: DatabasePanelState | undefined,
): DatabasePanelState | undefined {
  const remoteOrder = remotePanelState?.schedulerMemberOrder;
  if (!remoteOrder) return localPanelState;

  const localOrder = localPanelState?.schedulerMemberOrder ?? [];
  const remoteUpdatedAt = remotePanelState.schedulerMemberOrderUpdatedAt ?? 0;
  const localUpdatedAt = localPanelState?.schedulerMemberOrderUpdatedAt ?? 0;
  const remoteWins =
    remoteUpdatedAt > localUpdatedAt ||
    (remoteUpdatedAt === localUpdatedAt && !stringArrayEqual(remoteOrder, localOrder));
  if (!remoteWins) return localPanelState;

  return {
    ...(localPanelState ?? remotePanelState),
    schedulerMemberOrder: [...remoteOrder],
    schedulerMemberOrderUpdatedAt: remoteUpdatedAt,
  };
}

function resolvePanelStateWithLocalFallback(
  localPanelState: DatabasePanelState | undefined,
  remotePanelState: DatabasePanelState | undefined,
): DatabasePanelState | undefined {
  // 서버가 빈 panelState({})로 잘못 덮인 경우(과거 회귀로 탭 유실), local 에 탭이 있으면 보존한다.
  const remoteHasPresets = (remotePanelState?.filterPresets?.length ?? 0) > 0;
  const localHasPresets = (localPanelState?.filterPresets?.length ?? 0) > 0;
  const resolvedPanelState =
    remoteHasPresets || !localHasPresets ? (remotePanelState ?? localPanelState) : localPanelState;

  return mergeRemoteSchedulerMemberOrder(resolvedPanelState, remotePanelState);
}

function mergeRemoteSchedulerMemberOrderIntoLocalDatabase(
  db: GqlDatabase,
  local: DatabaseBundle | undefined,
  schema: Pick<DatabaseBundle, "columns" | "presets" | "panelState"> | null,
): boolean {
  if (!local || db.id !== LC_SCHEDULER_DATABASE_ID || !schema?.panelState) return false;
  const nextPanelState = mergeRemoteSchedulerMemberOrder(local.panelState, schema.panelState);
  if (nextPanelState === local.panelState) return false;

  useDatabaseStore.setState((s) => {
    const bundle = s.databases[db.id];
    if (!bundle) return s;
    return {
      ...s,
      databases: {
        ...s.databases,
        [db.id]: {
          ...bundle,
          panelState: nextPanelState,
        },
      },
      cacheWorkspaceId: resolveNextCacheWorkspaceId(s.cacheWorkspaceId, db.workspaceId),
    };
  });
  return true;
}

export function applyRemoteDatabaseToStore(
  d: GqlDatabase | null | undefined,
): void {
  if (!d) return;
  const remote = d;
  if (isLegacyLCSchedulerDatabaseId(remote.id)) {
    useDatabaseStore.setState((s) => {
      if (!s.databases[remote.id]) return s;
      const rest = { ...s.databases };
      delete rest[remote.id];
      return { ...s, databases: rest };
    });
    return;
  }

  const normalizedDatabase = isLCSchedulerDatabaseId(remote.id)
    ? {
        ...remote,
        id: LC_SCHEDULER_DATABASE_ID,
        workspaceId: LC_SCHEDULER_WORKSPACE_ID,
        title: LC_SCHEDULER_DATABASE_TITLE,
      }
    : remote;
  // legacy LC 스케줄러 id(canonical 이 아닌 prefix 매치) 만 1회 재업서트해 마이그레이션한다.
  // 참조 비교(normalizedDatabase !== remote)는 canonical id 에도 항상 true 라 매 수신마다
  // 재업서트 → echo → 무한 루프를 만들었다. 값 기준(legacy 여부)으로 차단한다.
  if (isLegacyLCSchedulerDatabaseId(remote.id)) {
    queueMicrotask(() => {
      enqueueAsync("upsertDatabase", {
        id: normalizedDatabase.id,
        workspaceId: normalizedDatabase.workspaceId,
        createdByMemberId: normalizedDatabase.createdByMemberId,
        title: normalizedDatabase.title,
        columns: normalizedDatabase.columns,
        presets: normalizedDatabase.presets,
        panelState: normalizedDatabase.panelState,
        templates: normalizedDatabase.templates,
        createdAt: normalizedDatabase.createdAt,
        updatedAt: normalizedDatabase.updatedAt,
      });
    });
  }
  const db = normalizedDatabase;
  if (!shouldApplyRemoteSnapshot(db.workspaceId)) return;
  if (
    !db.deletedAt &&
    shouldIgnoreRemoteAfterLocalDelete("database", db.id, db.workspaceId, db.updatedAt)
  ) {
    return;
  }

  const local = useDatabaseStore.getState().databases[db.id];

  if (db.deletedAt) {
    if (isProtectedDatabaseId(db.id)) {
      useDatabaseStore.setState((s) =>
        s.cacheWorkspaceId === resolveNextCacheWorkspaceId(s.cacheWorkspaceId, db.workspaceId)
          ? s
          : { ...s, cacheWorkspaceId: resolveNextCacheWorkspaceId(s.cacheWorkspaceId, db.workspaceId) },
      );
      return;
    }
    useDatabaseStore.setState((s) => {
      const bundle = s.databases[db.id];
      if (!bundle) return s;
      const rest = { ...s.databases };
      const nextTemplates = { ...s.dbTemplates };
      delete rest[db.id];
      delete nextTemplates[db.id];
      return { ...s, databases: rest, dbTemplates: nextTemplates, cacheWorkspaceId: db.workspaceId };
    });
    return;
  }

  const schema = parseRemoteDatabaseSchema(db);
  if (!schema) return;

  if (local && !isRemoteNewer(local.meta.updatedAt, db.updatedAt)) {
    if (mergeRemoteSchedulerMemberOrderIntoLocalDatabase(db, local, schema)) return;
    useDatabaseStore.setState((s) =>
      s.cacheWorkspaceId === resolveNextCacheWorkspaceId(s.cacheWorkspaceId, db.workspaceId)
        ? s
        : { ...s, cacheWorkspaceId: resolveNextCacheWorkspaceId(s.cacheWorkspaceId, db.workspaceId) },
    );
    return;
  }

  const { columns, presets, panelState, templates } = schema;
  const derivedRowOrder = collectRowPageIdsForDatabase(db.id);
  const rowPageOrder = mergeRowPageOrderWithDerived(local?.rowPageOrder, derivedRowOrder);
  const resolvedPanelState = resolvePanelStateWithLocalFallback(local?.panelState, panelState);

  const bundle: DatabaseBundle = {
    meta: {
      id: db.id,
      workspaceId: db.workspaceId,
      title: db.title,
      createdAt: isoToMs(db.createdAt) || Date.now(),
      updatedAt: isoToMs(db.updatedAt) || Date.now(),
    },
    columns,
    presets,
    panelState: resolvedPanelState,
    rowPageOrder,
  };

  useDatabaseStore.setState((s) => ({
    ...s,
    databases: { ...s.databases, [db.id]: bundle },
    dbTemplates:
      templates !== undefined
        ? { ...s.dbTemplates, [db.id]: templates }
        : s.dbTemplates,
    cacheWorkspaceId: resolveNextCacheWorkspaceId(s.cacheWorkspaceId, db.workspaceId),
  }));
  repairDbHistoryBaselineIfNeeded(db.id, structuredClone(bundle));
}

export function applyRemoteDatabasesToStore(
  remoteDatabases: Array<GqlDatabase | null | undefined>,
): void {
  if (remoteDatabases.length === 0) return;
  const normalizedDatabases: GqlDatabase[] = [];
  const legacyDeleteIds = new Set<string>();
  const candidateDatabaseIds = new Set<string>();
  const shouldIgnoreLocalDelete = createLocalDeleteGuardChecker();

  for (const d of remoteDatabases) {
    if (!d) continue;
    if (isLegacyLCSchedulerDatabaseId(d.id)) {
      legacyDeleteIds.add(d.id);
      continue;
    }
    const normalizedDatabase = isLCSchedulerDatabaseId(d.id)
      ? {
          ...d,
          id: LC_SCHEDULER_DATABASE_ID,
          workspaceId: LC_SCHEDULER_WORKSPACE_ID,
          title: LC_SCHEDULER_DATABASE_TITLE,
        }
      : d;
    // legacy LC 스케줄러 id 만 1회 재업서트(참조 비교 무한 루프 차단 — 위 단건 경로와 동일).
    if (isLegacyLCSchedulerDatabaseId(d.id)) {
      queueMicrotask(() => {
        enqueueAsync("upsertDatabase", {
          id: normalizedDatabase.id,
          workspaceId: normalizedDatabase.workspaceId,
          createdByMemberId: normalizedDatabase.createdByMemberId,
          title: normalizedDatabase.title,
          columns: normalizedDatabase.columns,
          presets: normalizedDatabase.presets,
          templates: normalizedDatabase.templates,
          createdAt: normalizedDatabase.createdAt,
          updatedAt: normalizedDatabase.updatedAt,
        });
      });
    }
    if (!shouldApplyRemoteSnapshot(normalizedDatabase.workspaceId)) continue;
    if (
      !normalizedDatabase.deletedAt &&
      shouldIgnoreLocalDelete(
        "database",
        normalizedDatabase.id,
        normalizedDatabase.workspaceId,
        normalizedDatabase.updatedAt,
      )
    ) {
      continue;
    }
    normalizedDatabases.push(normalizedDatabase);
    if (!normalizedDatabase.deletedAt) candidateDatabaseIds.add(normalizedDatabase.id);
  }


  if (normalizedDatabases.length === 0 && legacyDeleteIds.size === 0) return;

  const derivedByDbId = collectRowPageIdsForDatabases(candidateDatabaseIds);
  const repairedBundles: DatabaseBundle[] = [];
  const databaseDebugRows: Array<Record<string, unknown>> = [];

  useDatabaseStore.setState((s) => {
    let databases = s.databases;
    let dbTemplates = s.dbTemplates;
    let nextCacheWorkspaceId = s.cacheWorkspaceId;
    let changed = false;

    const ensureDatabasesCopy = () => {
      if (databases === s.databases) databases = { ...s.databases };
    };
    const ensureTemplatesCopy = () => {
      if (dbTemplates === s.dbTemplates) dbTemplates = { ...s.dbTemplates };
    };

    for (const id of legacyDeleteIds) {
      if (!databases[id]) continue;
      ensureDatabasesCopy();
      ensureTemplatesCopy();
      delete databases[id];
      delete dbTemplates[id];
      databaseDebugRows.push({ databaseId: id, action: "legacy-delete" });
      changed = true;
    }

    for (const db of normalizedDatabases) {
      nextCacheWorkspaceId = resolveNextCacheWorkspaceId(nextCacheWorkspaceId, db.workspaceId);

      if (db.deletedAt) {
        if (isProtectedDatabaseId(db.id)) {
          databaseDebugRows.push({ databaseId: db.id, action: "delete-skip-protected" });
          continue;
        }
        if (!databases[db.id]) {
          databaseDebugRows.push({ databaseId: db.id, action: "delete-skip-missing-local" });
          continue;
        }
        ensureDatabasesCopy();
        ensureTemplatesCopy();
        delete databases[db.id];
        delete dbTemplates[db.id];
        databaseDebugRows.push({ databaseId: db.id, action: "delete" });
        changed = true;
        continue;
      }

      const schema = parseRemoteDatabaseSchema(db);
      if (!schema) {
        databaseDebugRows.push({ databaseId: db.id, action: "schema-invalid" });
        continue;
      }
      const local = databases[db.id];
      if (local && !isRemoteNewer(local.meta.updatedAt, db.updatedAt)) {
        const derived = derivedByDbId.get(db.id) ?? [];
        const rowPageOrder = mergeRowPageOrderWithDerived(local.rowPageOrder, derived);
        const nextPanelState =
          db.id === LC_SCHEDULER_DATABASE_ID
            ? mergeRemoteSchedulerMemberOrder(local.panelState, schema.panelState)
            : local.panelState;
        if (
          !stringArrayEqual(local.rowPageOrder, rowPageOrder) ||
          nextPanelState !== local.panelState
        ) {
          ensureDatabasesCopy();
          databases[db.id] = { ...local, panelState: nextPanelState, rowPageOrder };
          changed = true;
          databaseDebugRows.push({
            databaseId: db.id,
            workspaceId: db.workspaceId,
            action: "stale-repair",
            localUpdatedAt: local.meta.updatedAt,
            remoteUpdatedAt: db.updatedAt,
            localRowCount: local.rowPageOrder.length,
            derivedRowCount: derived.length,
            nextRowCount: rowPageOrder.length,
            panelStateChanged: nextPanelState !== local.panelState,
          });
        } else {
          databaseDebugRows.push({
            databaseId: db.id,
            workspaceId: db.workspaceId,
            action: "stale-skip",
            localUpdatedAt: local.meta.updatedAt,
            remoteUpdatedAt: db.updatedAt,
            localRowCount: local.rowPageOrder.length,
            derivedRowCount: derived.length,
          });
        }
        continue;
      }

      const { columns, presets, panelState, templates } = schema;
      const derivedRowOrder = derivedByDbId.get(db.id) ?? [];
      const rowPageOrder = mergeRowPageOrderWithDerived(local?.rowPageOrder, derivedRowOrder);
      // 단건 경로(applyRemoteDatabaseToStore)와 동일하게 panelState 를 반영해야 한다.
      // (과거 누락으로 전체 페치/새로고침 시 스케줄러 DB 의 표시설정·구성원 순서가 사라졌다.)
      const resolvedPanelState = resolvePanelStateWithLocalFallback(local?.panelState, panelState);
      const bundle: DatabaseBundle = {
        meta: {
          id: db.id,
          workspaceId: db.workspaceId,
          title: db.title,
          createdAt: isoToMs(db.createdAt) || Date.now(),
          updatedAt: isoToMs(db.updatedAt) || Date.now(),
        },
        columns,
        presets,
        panelState: resolvedPanelState,
        rowPageOrder,
      };

      ensureDatabasesCopy();
      databases[db.id] = bundle;
      if (templates !== undefined) {
        ensureTemplatesCopy();
        dbTemplates[db.id] = templates;
      }
      repairedBundles.push(bundle);
      databaseDebugRows.push({
        databaseId: db.id,
        workspaceId: db.workspaceId,
        action: local ? "upsert-newer" : "upsert-new-local",
        localUpdatedAt: local?.meta.updatedAt ?? null,
        remoteUpdatedAt: db.updatedAt,
        localRowCount: local?.rowPageOrder.length ?? null,
        derivedRowCount: derivedRowOrder.length,
        nextRowCount: rowPageOrder.length,
      });
      changed = true;
    }

    if (!changed && nextCacheWorkspaceId === s.cacheWorkspaceId) return s;
    return {
      ...s,
      databases,
      dbTemplates,
      cacheWorkspaceId: nextCacheWorkspaceId,
    };
  });

  for (const bundle of repairedBundles) {
    repairDbHistoryBaselineIfNeeded(bundle.meta.id, structuredClone(bundle));
  }
}

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
