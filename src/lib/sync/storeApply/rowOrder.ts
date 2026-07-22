// rowPageOrder 파생·정합 sink. page·database 양쪽 reducer 가 공유한다.
import { usePageStore } from "../../../store/pageStore";
import { useDatabaseStore } from "../../../store/databaseStore";
import type { Page } from "../../../types/page";
import { stringArrayEqual, mergeRowPageOrderWithDerived } from "./helpers";

function collectTemplatePageIds(databaseId: string): Set<string> {
  return new Set(
    (useDatabaseStore.getState().dbTemplates[databaseId] ?? [])
      .map((template) => template.pageId)
      .filter((pageId): pageId is string => Boolean(pageId)),
  );
}

function removeKnownTemplatePageIds(databaseId: string, pageIds: string[]): string[] {
  const templatePageIds = collectTemplatePageIds(databaseId);
  return templatePageIds.size === 0
    ? pageIds
    : pageIds.filter((pageId) => !templatePageIds.has(pageId));
}

/** AppSync Database 모델에는 rowPageOrder 가 없으므로, 페이지 스토어에서 역추적한다.
 *  _qn_isTemplate 마커가 있는 페이지는 템플릿이므로 행 목록에서 제외한다.
 *  필터/정렬 규칙을 배치 버전과 한곳에서 공유해 두 경로가 어긋나지 않게 한다
 *  (단건 호출은 구독 이벤트당 1회이므로 1회 pages 순회 비용은 동일하게 유지). */
export function collectRowPageIdsForDatabase(databaseId: string): string[] {
  return collectRowPageIdsForDatabases(new Set([databaseId])).get(databaseId) ?? [];
}

export function collectRowPageIdsForDatabases(databaseIds: Set<string>): Map<string, string[]> {
  const out = new Map<string, Page[]>();
  for (const id of databaseIds) out.set(id, []);
  if (out.size === 0) return new Map();
  const templatePageIdsByDatabase = new Map(
    [...databaseIds].map((databaseId) => [databaseId, collectTemplatePageIds(databaseId)]),
  );
  const pages = usePageStore.getState().pages;
  for (const page of Object.values(pages)) {
    if (!page.databaseId || !databaseIds.has(page.databaseId)) continue;
    if (page.dbCells?.["_qn_isTemplate"] === "1") continue;
    if (templatePageIdsByDatabase.get(page.databaseId)?.has(page.id)) continue;
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

export function reconcileDatabaseRowOrders(databaseIds: Set<string>): void {
  if (databaseIds.size === 0) return;
  const derivedByDbId = collectRowPageIdsForDatabases(databaseIds);
  useDatabaseStore.setState((s) => {
    let databases = s.databases;
    let changed = false;
    for (const databaseId of databaseIds) {
      const db = databases[databaseId];
      if (!db) continue;
      const derived = derivedByDbId.get(databaseId) ?? [];
      const rowPageOrder = removeKnownTemplatePageIds(
        databaseId,
        mergeRowPageOrderWithDerived(db.rowPageOrder, derived),
      );
      if (stringArrayEqual(db.rowPageOrder, rowPageOrder)) continue;
      if (!changed) databases = { ...s.databases };
      changed = true;
      databases[databaseId] = { ...db, rowPageOrder };
    }
    return changed ? { ...s, databases } : s;
  });
}

export function removePageIdFromDatabaseRowOrder(databaseId: string, pageId: string): void {
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
 *  템플릿 페이지(_qn_isTemplate)는 이미 들어간 stale 행 순서에서도 즉시 제거한다. */
export function ensurePageInDatabaseRowOrder(databaseId: string, pageId: string): void {
  const page = usePageStore.getState().pages[pageId];
  if (
    page?.dbCells?.["_qn_isTemplate"] === "1" ||
    collectTemplatePageIds(databaseId).has(pageId)
  ) {
    removePageIdFromDatabaseRowOrder(databaseId, pageId);
    return;
  }
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
