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
import type { ColumnDef, DatabaseBundle } from "../../types/database";
import type { JSONContent } from "@tiptap/react";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { repairDbHistoryBaselineIfNeeded } from "../../store/historyStore";
import type { BlockCommentMsg } from "../../types/blockComment";

/**
 * 구독 레이스·백엔드 오류로 다른 워크스페이스 스냅샷이 내려올 때 로컬 캐시가 오염되지 않게 한다.
 */
function shouldApplyRemoteSnapshot(remoteWorkspaceId: string | null | undefined): boolean {
  if (remoteWorkspaceId == null || remoteWorkspaceId === "") {
    console.warn("[sync] storeApply: workspaceId 없는 원격 항목은 적용하지 않음");
    return false;
  }
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
  p: GqlPage | null | undefined,
): void {
  if (!p) return;
  if (!shouldApplyRemoteSnapshot(p.workspaceId)) return;

  usePageStore.setState((s) => {
    const local = s.pages[p.id];
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
        cacheWorkspaceId: p.workspaceId,
      };
    }
    if (local && !shouldApplyRemotePageOverwrite(local, p)) {
      return s.cacheWorkspaceId === p.workspaceId ? s : { ...s, cacheWorkspaceId: p.workspaceId };
    }

    const orderNum = gqlOrderNumber(p);

    const merged: Page = {
      id: p.id,
      title: p.title,
      icon: p.icon ?? null,
      coverImage: typeof p.coverImage === "string" ? p.coverImage : null,
      doc: parseAwsJson<JSONContent>(p.doc, {
        type: "doc",
        content: [{ type: "paragraph" }],
      }),
      parentId: p.parentId ?? null,
      order: orderNum,
      databaseId: p.databaseId ?? undefined,
      dbCells: parseAwsJson<Page["dbCells"]>(p.dbCells, undefined),
      createdByMemberId: p.createdByMemberId ?? undefined,
      createdAt: isoToMs(p.createdAt) || Date.now(),
      updatedAt: isoToMs(p.updatedAt) || Date.now(),
    };
    return {
      ...s,
      pages: { ...s.pages, [p.id]: merged },
      cacheWorkspaceId: p.workspaceId,
    };
  });

  if (p.deletedAt) {
    const before = usePageStore.getState().pages[p.id];
    const dbId = before?.databaseId;
    if (dbId) removePageIdFromDatabaseRowOrder(dbId, p.id);
    return;
  }

  const after = usePageStore.getState().pages[p.id];
  if (after?.databaseId) {
    ensurePageInDatabaseRowOrder(after.databaseId, after.id);
  }
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

export function applyRemoteDatabaseToStore(
  d: GqlDatabase | null | undefined,
): void {
  if (!d) return;
  if (!shouldApplyRemoteSnapshot(d.workspaceId)) return;

  const local = useDatabaseStore.getState().databases[d.id];

  if (d.deletedAt) {
    useDatabaseStore.setState((s) => {
      const bundle = s.databases[d.id];
      if (!bundle) return s;
      const rest = { ...s.databases };
      delete rest[d.id];
      return { ...s, databases: rest, cacheWorkspaceId: d.workspaceId };
    });
    return;
  }

  if (local && !isRemoteNewer(local.meta.updatedAt, d.updatedAt)) {
    useDatabaseStore.setState((s) =>
      s.cacheWorkspaceId === d.workspaceId
        ? s
        : { ...s, cacheWorkspaceId: d.workspaceId },
    );
    return;
  }

  const columns = parseAwsJson<ColumnDef[]>(d.columns, []);
  const derivedRowOrder = collectRowPageIdsForDatabase(d.id);
  const rowPageOrder = mergeRowPageOrderWithDerived(local?.rowPageOrder, derivedRowOrder);

  const bundle: DatabaseBundle = {
    meta: {
      id: d.id,
      title: d.title,
      createdAt: isoToMs(d.createdAt) || Date.now(),
      updatedAt: isoToMs(d.updatedAt) || Date.now(),
    },
    columns,
    rowPageOrder,
  };

  useDatabaseStore.setState((s) => ({
    ...s,
    databases: { ...s.databases, [d.id]: bundle },
    cacheWorkspaceId: d.workspaceId,
  }));

  repairDbHistoryBaselineIfNeeded(d.id, structuredClone(bundle));
}
