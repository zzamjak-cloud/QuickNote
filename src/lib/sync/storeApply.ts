// 원격(GraphQL) 변경을 로컬 zustand 스토어에 LWW 로 적용한다.
// - GraphQL 쪽은 ISO 문자열, 로컬 스토어는 epoch ms(number) — 경계에서 변환.
// - tombstone(deletedAt != null) 이면 로컬에서 제거.
// - 로컬이 더 신선하면 무시(LWW).

import type {
  GqlPage,
  GqlDatabase,
} from "./graphql/operations";
import type { GqlComment } from "./queries/comment";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useBlockCommentStore } from "../../store/blockCommentStore";
import type { Page } from "../../types/page";
import type { ColumnDef, DatabaseBundle, DatabaseRowPreset } from "../../types/database";
import type { JSONContent } from "@tiptap/react";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { repairDbHistoryBaselineIfNeeded } from "../../store/historyStore";
import type { BlockCommentMsg } from "../../types/blockComment";
import { enqueueAsync } from "./runtime";
import {
  LC_SCHEDULER_DATABASE_ID,
  LC_SCHEDULER_DATABASE_TITLE,
  isLCSchedulerDatabaseId,
  isLegacyLCSchedulerDatabaseId,
} from "../scheduler/database";
import { LC_SCHEDULER_WORKSPACE_ID } from "../scheduler/scope";
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

// 원격 ISO 문자열 → epoch ms (실패 시 0).
function isoToMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

// AppSync AWSJSON 응답은 보통 JSON 문자열로 도착한다(Amplify 가 자동 parse 해주는 경우도 있어 객체일 수 있음).
function parseAwsJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function isRemoteNewer(localUpdatedMs: number, remoteIso: string): boolean {
  const remoteMs = isoToMs(remoteIso);
  return remoteMs > localUpdatedMs;
}

/** GraphQL Page 의 order 를 스토어 number 와 동일 규칙으로 정규화 */
function gqlOrderNumber(p: { order: string; updatedAt: string }): number {
  const n = Number(p.order);
  if (!Number.isNaN(n)) return n;
  return isoToMs(p.updatedAt);
}

function gqlDatabaseId(p: GqlPage): string | null {
  return p.databaseId ?? null;
}

function isLCSchedulerPage(p: GqlPage): boolean {
  return Boolean(p.databaseId && isLCSchedulerDatabaseId(p.databaseId));
}

function toPageInputPayload(p: GqlPage): Record<string, unknown> & { id: string; updatedAt?: string } {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    createdByMemberId: p.createdByMemberId,
    title: p.title,
    icon: p.icon ?? null,
    coverImage: p.coverImage ?? null,
    parentId: p.parentId ?? null,
    order: p.order,
    databaseId: p.databaseId ?? null,
    doc: p.doc,
    dbCells: p.dbCells ?? null,
    blockComments: p.blockComments ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

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

/** 동일 updatedAt(LWW 동률)일 때 사이드바 트리가 어긋나 있으면 원격 메타를 받아들인다 */
function isPageStructuralDrift(local: Page, p: GqlPage): boolean {
  const remoteParent = p.parentId ?? null;
  const remoteOrder = gqlOrderNumber(p);
  const remoteDb = gqlDatabaseId(p);
  const localDb = local.databaseId ?? null;
  return (
    local.parentId !== remoteParent ||
    local.order !== remoteOrder ||
    localDb !== remoteDb
  );
}

/** 페이지 원격 덮어쓰기 여부 — 순수 초과 외에 LWW 동률+구조 불일치도 허용 */
function shouldApplyRemotePageOverwrite(local: Page | undefined, p: GqlPage): boolean {
  if (!local) return true;
  const remoteMs = isoToMs(p.updatedAt);
  const localMs = local.updatedAt;
  if (remoteMs > localMs) return true;
  if (remoteMs === localMs && localMs > 0 && isPageStructuralDrift(local, p)) {
    return true;
  }
  return false;
}

function gqlPageToLocalPage(p: GqlPage): Page {
  return {
    id: p.id,
    title: p.title,
    icon: p.icon ?? null,
    coverImage: typeof p.coverImage === "string" ? p.coverImage : null,
    doc: parseAwsJson<JSONContent>(p.doc, {
      type: "doc",
      content: [{ type: "paragraph" }],
    }),
    parentId: p.parentId ?? null,
    order: gqlOrderNumber(p),
    databaseId: p.databaseId ?? undefined,
    dbCells: parseAwsJson<Page["dbCells"]>(p.dbCells, undefined),
    createdByMemberId: p.createdByMemberId ?? undefined,
    createdAt: isoToMs(p.createdAt) || Date.now(),
    updatedAt: isoToMs(p.updatedAt) || Date.now(),
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

function stringArrayEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** 로컬 순서를 우선하되, 원격에서 새로 내려온 행 페이지는 끝에 붙인다. */
function mergeRowPageOrderWithDerived(
  localOrder: string[] | undefined,
  derived: string[],
): string[] {
  if (!derived.length) return localOrder?.length ? [...localOrder] : [];
  if (!localOrder?.length) return derived;
  const derivedSet = new Set(derived);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of localOrder) {
    if (!derivedSet.has(id)) continue;
    out.push(id);
    seen.add(id);
  }
  for (const id of derived) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
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
    if (local && !shouldApplyRemotePageOverwrite(local, p)) {
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
    if (deletedDbId) removePageIdFromDatabaseRowOrder(deletedDbId, p.id);
    return;
  }

  const after = usePageStore.getState().pages[p.id];
  if (after?.databaseId) {
    ensurePageInDatabaseRowOrder(after.databaseId, after.id);
  }
}

export function applyRemotePagesToStore(
  remotePages: Array<GqlPage | null | undefined>,
): void {
  if (remotePages.length === 0) return;
  const pages = remotePages
    .filter((remotePage): remotePage is GqlPage => Boolean(remotePage))
    .map(normalizeLCSchedulerPageWorkspace)
    .filter((p) => shouldApplyRemoteSnapshot(p.workspaceId));
  if (pages.length === 0) return;

  const affectedDatabaseIds = new Set<string>();

  usePageStore.setState((s) => {
    let nextPages = s.pages;
    let nextActive = s.activePageId;
    let nextCacheWorkspaceId = s.cacheWorkspaceId;
    let changed = false;

    const ensurePagesCopy = () => {
      if (nextPages === s.pages) nextPages = { ...s.pages };
    };

    for (const p of pages) {
      nextCacheWorkspaceId = resolveNextCacheWorkspaceId(nextCacheWorkspaceId, p.workspaceId);

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
      if (p.deletedAt) {
        if (!local) continue;
        ensurePagesCopy();
        delete nextPages[p.id];
        if (nextActive === p.id) nextActive = null;
        if (local.databaseId) affectedDatabaseIds.add(local.databaseId);
        changed = true;
        continue;
      }

      if (local && !shouldApplyRemotePageOverwrite(local, p)) continue;
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
  if (normalizedDatabase !== remote) {
    queueMicrotask(() => {
      enqueueAsync("upsertDatabase", {
        id: normalizedDatabase.id,
        workspaceId: normalizedDatabase.workspaceId,
        createdByMemberId: normalizedDatabase.createdByMemberId,
        title: normalizedDatabase.title,
        columns: normalizedDatabase.columns,
        presets: normalizedDatabase.presets,
        createdAt: normalizedDatabase.createdAt,
        updatedAt: normalizedDatabase.updatedAt,
      });
    });
  }
  const db = normalizedDatabase;
  if (!shouldApplyRemoteSnapshot(db.workspaceId)) return;

  const local = useDatabaseStore.getState().databases[db.id];

  if (db.deletedAt) {
    if (isLCSchedulerDatabaseId(db.id)) {
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
      delete rest[db.id];
      return { ...s, databases: rest, cacheWorkspaceId: db.workspaceId };
    });
    return;
  }

  if (local && !isRemoteNewer(local.meta.updatedAt, db.updatedAt)) {
    useDatabaseStore.setState((s) =>
      s.cacheWorkspaceId === resolveNextCacheWorkspaceId(s.cacheWorkspaceId, db.workspaceId)
        ? s
        : { ...s, cacheWorkspaceId: resolveNextCacheWorkspaceId(s.cacheWorkspaceId, db.workspaceId) },
    );
    return;
  }

  const columns = parseAwsJson<ColumnDef[]>(db.columns, []);
  const presets = parseAwsJson<DatabaseRowPreset[]>(db.presets, []);
  const derivedRowOrder = collectRowPageIdsForDatabase(db.id);
  const rowPageOrder = mergeRowPageOrderWithDerived(local?.rowPageOrder, derivedRowOrder);

  const bundle: DatabaseBundle = {
    meta: {
      id: db.id,
      title: db.title,
      createdAt: isoToMs(db.createdAt) || Date.now(),
      updatedAt: isoToMs(db.updatedAt) || Date.now(),
    },
    columns,
    presets,
    rowPageOrder,
  };

  useDatabaseStore.setState((s) => ({
    ...s,
    databases: { ...s.databases, [db.id]: bundle },
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
    if (normalizedDatabase !== d) {
      queueMicrotask(() => {
        enqueueAsync("upsertDatabase", {
          id: normalizedDatabase.id,
          workspaceId: normalizedDatabase.workspaceId,
          createdByMemberId: normalizedDatabase.createdByMemberId,
          title: normalizedDatabase.title,
          columns: normalizedDatabase.columns,
          presets: normalizedDatabase.presets,
          createdAt: normalizedDatabase.createdAt,
          updatedAt: normalizedDatabase.updatedAt,
        });
      });
    }
    if (!shouldApplyRemoteSnapshot(normalizedDatabase.workspaceId)) continue;
    normalizedDatabases.push(normalizedDatabase);
    if (!normalizedDatabase.deletedAt) candidateDatabaseIds.add(normalizedDatabase.id);
  }

  if (normalizedDatabases.length === 0 && legacyDeleteIds.size === 0) return;

  const derivedByDbId = collectRowPageIdsForDatabases(candidateDatabaseIds);
  const repairedBundles: DatabaseBundle[] = [];

  useDatabaseStore.setState((s) => {
    let databases = s.databases;
    let nextCacheWorkspaceId = s.cacheWorkspaceId;
    let changed = false;

    const ensureDatabasesCopy = () => {
      if (databases === s.databases) databases = { ...s.databases };
    };

    for (const id of legacyDeleteIds) {
      if (!databases[id]) continue;
      ensureDatabasesCopy();
      delete databases[id];
      changed = true;
    }

    for (const db of normalizedDatabases) {
      nextCacheWorkspaceId = resolveNextCacheWorkspaceId(nextCacheWorkspaceId, db.workspaceId);

      if (db.deletedAt) {
        if (isLCSchedulerDatabaseId(db.id)) continue;
        if (!databases[db.id]) continue;
        ensureDatabasesCopy();
        delete databases[db.id];
        changed = true;
        continue;
      }

      const local = databases[db.id];
      if (local && !isRemoteNewer(local.meta.updatedAt, db.updatedAt)) continue;

      const columns = parseAwsJson<ColumnDef[]>(db.columns, []);
      const presets = parseAwsJson<DatabaseRowPreset[]>(db.presets, []);
      const derivedRowOrder = derivedByDbId.get(db.id) ?? [];
      const rowPageOrder = mergeRowPageOrderWithDerived(local?.rowPageOrder, derivedRowOrder);
      const bundle: DatabaseBundle = {
        meta: {
          id: db.id,
          title: db.title,
          createdAt: isoToMs(db.createdAt) || Date.now(),
          updatedAt: isoToMs(db.updatedAt) || Date.now(),
        },
        columns,
        presets,
        rowPageOrder,
      };

      ensureDatabasesCopy();
      databases[db.id] = bundle;
      repairedBundles.push(bundle);
      changed = true;
    }

    if (!changed && nextCacheWorkspaceId === s.cacheWorkspaceId) return s;
    return {
      ...s,
      databases,
      cacheWorkspaceId: nextCacheWorkspaceId,
    };
  });

  for (const bundle of repairedBundles) {
    repairDbHistoryBaselineIfNeeded(bundle.meta.id, structuredClone(bundle));
  }
}
