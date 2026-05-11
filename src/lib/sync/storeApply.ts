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
import type { Page } from "../../types/page";
import type { PageBlockCommentsSnapshot } from "../../types/blockComment";
import { coercePageBlockComments } from "../comments/blockCommentSnapshot";
import { mergePageBlockComments } from "../comments/mergePageBlockComments";
import { notifyRemoteBlockCommentDelta } from "../comments/notifyRemoteBlockCommentDelta";
import { useMemberStore } from "../../store/memberStore";
import type {
  ColumnDef,
  DatabaseBundle,
} from "../../types/database";
import type { JSONContent } from "@tiptap/react";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { repairDbHistoryBaselineIfNeeded } from "../../store/historyStore";

/**
 * 구독 레이스·백엔드 오류로 다른 워크스페이스 스냅샷이 내려올 때 로컬 캐시가 오염되지 않게 한다.
 * currentWorkspaceId 가 없으면(부트 초기 등) 검사를 생략한다.
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
// 둘 다 안전하게 처리한다.
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
  return isoToMs(remoteIso) > localUpdatedMs;
}

/** AppSync Database 모델에는 rowPageOrder 가 없으므로, 페이지 스토어에서 역추적한다. */
function collectRowPageIdsForDatabase(databaseId: string): string[] {
  const pages = usePageStore.getState().pages;
  return Object.values(pages)
    .filter((page) => page.databaseId === databaseId)
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

/** 구독 순서상 DB 스냅샷보다 행 페이지가 먼저 올 때 rowPageOrder 에 id 가 빠지지 않게 한다. */
function ensurePageInDatabaseRowOrder(databaseId: string, pageId: string): void {
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
  options?: { skipBlockCommentNotifications?: boolean },
): void {
  if (!p) return;
  if (!shouldApplyRemoteSnapshot(p.workspaceId)) return;

  const before = usePageStore.getState().pages[p.id];

  usePageStore.setState((s) => {
    const local = s.pages[p.id];
    // tombstone — 로컬에서 제거.
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
    // 로컬이 더 신선하면 무시.
    if (local && !isRemoteNewer(local.updatedAt, p.updatedAt)) {
      return s.cacheWorkspaceId === p.workspaceId
        ? s
        : { ...s, cacheWorkspaceId: p.workspaceId };
    }

    const orderNum = (() => {
      const n = Number(p.order);
      if (!Number.isNaN(n)) return n;
      return isoToMs(p.updatedAt);
    })();

    const remoteBlockComments: PageBlockCommentsSnapshot | undefined =
      p.blockComments != null
        ? coercePageBlockComments(parseAwsJson<unknown>(p.blockComments, null))
        : undefined;
    // 원격에 blockComments 가 없거나 비어 있으면 로컬 스레드가 통째로 사라지지 않게 합친다.
    const mergedBlockComments = mergePageBlockComments(
      remoteBlockComments,
      local?.blockComments,
    );

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
      ...(mergedBlockComments ? { blockComments: mergedBlockComments } : {}),
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
    const dbId = before?.databaseId;
    if (dbId) removePageIdFromDatabaseRowOrder(dbId, p.id);
    return;
  }

  const after = usePageStore.getState().pages[p.id];
  if (after?.databaseId) {
    ensurePageInDatabaseRowOrder(after.databaseId, after.id);
  }

  if (options?.skipBlockCommentNotifications !== true) {
    const myMemberId = useMemberStore.getState().me?.memberId;
    notifyRemoteBlockCommentDelta(
      myMemberId,
      before?.blockComments,
      after?.blockComments,
    );
  }
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
  // 원격은 rowPageOrder 를 모르므로: 로컬 순서 보존 + 페이지 스토어에서 역산해 빈 캐시 복구.
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

  // 서버에서 온 DB는 로컬에 db.create 가 없을 수 있다. 고아 패치만 있으면 타임라인이 비게 된다.
  repairDbHistoryBaselineIfNeeded(d.id, structuredClone(bundle));
}
