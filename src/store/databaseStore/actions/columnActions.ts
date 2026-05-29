import type { StoreApi } from "zustand";
import type { ColumnDef } from "../../../types/database";
import type { DbMap } from "../migrations";
import type { DatabaseStore } from "../../databaseStore";
import { newId } from "../../../lib/id";
import { usePageStore } from "../../pageStore";
import { shouldWriteAnchor, useHistoryStore } from "../../historyStore";
import {
  defaultCellValueForColumn,
  enqueueUpsertDatabase,
  enqueueUpsertPageRaw,
  toDatabaseSnapshot,
} from "../helpers";

type DatabaseStoreSet = StoreApi<DatabaseStore>["setState"];
type DatabaseStoreGet = StoreApi<DatabaseStore>["getState"];

type ColumnActions = Pick<
  DatabaseStore,
  "addColumn" | "updateColumn" | "removeColumn" | "moveColumn"
>;

function now(): number {
  return Date.now();
}

function syncPageLinkMirrorColumn(
  databases: DbMap,
  sourceDatabaseId: string,
  sourceColumnId: string,
): string[] {
  const sourceBundle = databases[sourceDatabaseId];
  if (!sourceBundle) return [];
  const sourceColumn = sourceBundle.columns.find((c) => c.id === sourceColumnId);
  if (!sourceColumn || sourceColumn.type !== "pageLink") return [];
  const targetDatabaseId = sourceColumn.config?.pageLinkScopeDatabaseId;
  if (!targetDatabaseId) return [];
  const targetBundle = databases[targetDatabaseId];
  if (!targetBundle) return [];
  const targetColumnName = sourceColumn.config?.pageLinkReverseColumnName ?? sourceColumn.name;
  if (!targetColumnName) return [];
  const targetColumn = targetBundle.columns.find(
    (c) => c.type === "pageLink" && c.name === targetColumnName,
  );
  if (!targetColumn) return [];

  const pageStore = usePageStore.getState();
  const sourceRowSet = new Set(sourceBundle.rowPageOrder);
  const linksByTargetPageId = new Map<string, string[]>();
  for (const sourcePageId of sourceBundle.rowPageOrder) {
    const raw = pageStore.pages[sourcePageId]?.dbCells?.[sourceColumnId];
    if (!Array.isArray(raw)) continue;
    for (const targetPageId of raw) {
      if (typeof targetPageId !== "string") continue;
      const targetPage = pageStore.pages[targetPageId];
      if (targetPage?.databaseId !== targetDatabaseId) continue;
      const prev = linksByTargetPageId.get(targetPageId) ?? [];
      prev.push(sourcePageId);
      linksByTargetPageId.set(targetPageId, prev);
    }
  }

  const touchedPageIds: string[] = [];
  const t = Date.now();
  usePageStore.setState((state) => {
    let changed = false;
    const nextPages = { ...state.pages };
    for (const targetPageId of targetBundle.rowPageOrder) {
      const page = nextPages[targetPageId];
      if (!page) continue;
      const existingRaw = page.dbCells?.[targetColumn.id];
      const existingIds: string[] = Array.isArray(existingRaw)
        ? (existingRaw.filter((v) => typeof v === "string") as string[])
        : [];
      const manualIds = existingIds.filter((id) => !sourceRowSet.has(id));
      const syncedIds = linksByTargetPageId.get(targetPageId) ?? [];
      const nextIds = Array.from(new Set([...manualIds, ...syncedIds]));
      if (
        existingIds.length === nextIds.length &&
        existingIds.every((id, idx) => id === nextIds[idx])
      ) {
        continue;
      }
      changed = true;
      touchedPageIds.push(targetPageId);
      nextPages[targetPageId] = {
        ...page,
        dbCells: { ...(page.dbCells ?? {}), [targetColumn.id]: nextIds },
        updatedAt: t,
      };
    }
    return changed ? { pages: nextPages } : state;
  });

  return touchedPageIds;
}


export function createColumnActions(
  set: DatabaseStoreSet,
  get: DatabaseStoreGet,
): ColumnActions {
  return {
    addColumn: (databaseId, colIn) => {
      const colId = colIn.id ?? newId();
      const col: ColumnDef = {
        id: colId,
        name: colIn.name,
        type: colIn.type,
        config: colIn.config,
      };
      const defaultValue = defaultCellValueForColumn(col);
      set((state) => {
        const bundle = state.databases[databaseId];
        if (!bundle) return state;
        return {
          databases: {
            ...state.databases,
            [databaseId]: {
              ...bundle,
              columns: [...bundle.columns, col],
              meta: { ...bundle.meta, updatedAt: now() },
            },
          },
        };
      });
      // 기본값이 있는 컬럼(status 등) 추가 시 기존 행 페이지에도 채운다.
      const mutatedRowPageIds: string[] = [];
      if (defaultValue != null) {
        const bundle = get().databases[databaseId];
        if (bundle) {
          const t = Date.now();
          usePageStore.setState((s) => {
            const nextPages = { ...s.pages };
            for (const pageId of bundle.rowPageOrder) {
              const page = nextPages[pageId];
              if (!page) continue;
              nextPages[pageId] = {
                ...page,
                dbCells: { ...(page.dbCells ?? {}), [colId]: defaultValue },
                updatedAt: t,
              };
              mutatedRowPageIds.push(pageId);
            }
            return { pages: nextPages };
          });
        }
      }
      const bundleAfter = get().databases[databaseId];
      if (bundleAfter) {
        const hs = useHistoryStore.getState();
        const events = hs.dbEventsByDatabaseId[databaseId] ?? [];
        hs.recordDbEvent(
          databaseId,
          "db.column.add",
          { columns: structuredClone(bundleAfter.columns) },
          shouldWriteAnchor(events.length + 1)
            ? toDatabaseSnapshot(bundleAfter)
            : undefined,
        );
        enqueueUpsertDatabase(bundleAfter);
      }
      const pages = usePageStore.getState().pages;
      for (const pid of mutatedRowPageIds) {
        const p = pages[pid];
        if (p) enqueueUpsertPageRaw(p);
      }
      return colId;
    },

    updateColumn: (databaseId, columnId, patch) => {
      const patchForColumn = patch;
      const beforeColumn = get().databases[databaseId]?.columns.find((c) => c.id === columnId);
      set((state) => {
        const bundle = state.databases[databaseId];
        if (!bundle) return state;
        const next = bundle.columns.map((c) => {
          if (c.id !== columnId) return c;
          if (c.type === "title" && patchForColumn.type && patchForColumn.type !== "title") {
            return c;
          }
          return { ...c, ...patchForColumn, id: c.id };
        });
        return {
          databases: {
            ...state.databases,
            [databaseId]: {
              ...bundle,
              columns: next,
              meta: { ...bundle.meta, updatedAt: now() },
            },
          },
        };
      });
      const bundleAfter = get().databases[databaseId];
      if (bundleAfter) {
        const hs = useHistoryStore.getState();
        const events = hs.dbEventsByDatabaseId[databaseId] ?? [];
        hs.recordDbEvent(
          databaseId,
          "db.column.update",
          { columns: structuredClone(bundleAfter.columns) },
          shouldWriteAnchor(events.length + 1)
            ? toDatabaseSnapshot(bundleAfter)
            : undefined,
        );
        enqueueUpsertDatabase(bundleAfter);
      }
      const afterColumn = bundleAfter?.columns.find((c) => c.id === columnId);
      const shouldSyncMirror =
        afterColumn?.type === "pageLink" &&
        (beforeColumn?.config?.pageLinkScopeDatabaseId !== afterColumn.config?.pageLinkScopeDatabaseId ||
          beforeColumn?.config?.pageLinkReverseColumnName !== afterColumn.config?.pageLinkReverseColumnName);
      if (shouldSyncMirror) {
        const touchedPageIds = syncPageLinkMirrorColumn(get().databases, databaseId, columnId);
        const pages = usePageStore.getState().pages;
        for (const pageId of touchedPageIds) {
          const page = pages[pageId];
          if (page) enqueueUpsertPageRaw(page);
        }
      }
    },

    removeColumn: (databaseId, columnId) => {
      const bundleBefore = get().databases[databaseId];
      if (!bundleBefore) return;
      const target = bundleBefore.columns.find((c) => c.id === columnId);
      if (!target || target.type === "title") return;
      const nextCols = bundleBefore.columns.filter((c) => c.id !== columnId);

      const mutatedRowPageIds: string[] = [];
      usePageStore.setState((s) => {
        let changed = false;
        const nextPages = { ...s.pages };
        const t = Date.now();
        for (const pageId of bundleBefore.rowPageOrder) {
          const page = nextPages[pageId];
          if (!page?.dbCells || !(columnId in page.dbCells)) continue;
          changed = true;
          const nextCells = { ...page.dbCells };
          delete nextCells[columnId];
          nextPages[pageId] = { ...page, dbCells: nextCells, updatedAt: t };
          mutatedRowPageIds.push(pageId);
        }
        return changed ? { pages: nextPages } : s;
      });

      set((state) => {
        const bundle = state.databases[databaseId];
        if (!bundle) return state;
        return {
          databases: {
            ...state.databases,
            [databaseId]: {
              ...bundle,
              columns: nextCols,
              meta: { ...bundle.meta, updatedAt: now() },
            },
          },
        };
      });
      const bundleAfter = get().databases[databaseId];
      if (bundleAfter) {
        const hs = useHistoryStore.getState();
        const events = hs.dbEventsByDatabaseId[databaseId] ?? [];
        hs.recordDbEvent(
          databaseId,
          "db.column.remove",
          { columns: structuredClone(bundleAfter.columns) },
          shouldWriteAnchor(events.length + 1)
            ? toDatabaseSnapshot(bundleAfter)
            : undefined,
        );
        enqueueUpsertDatabase(bundleAfter);
      }
      const pages = usePageStore.getState().pages;
      for (const pid of mutatedRowPageIds) {
        const p = pages[pid];
        if (p) enqueueUpsertPageRaw(p);
      }
    },

    moveColumn: (databaseId, fromIdx, toIdx) => {
      set((state) => {
        const bundle = state.databases[databaseId];
        if (!bundle) return state;
        if (
          fromIdx < 0 ||
          toIdx < 0 ||
          fromIdx >= bundle.columns.length ||
          toIdx >= bundle.columns.length ||
          fromIdx === toIdx
        ) {
          return state;
        }
        const next = [...bundle.columns];
        const [moved] = next.splice(fromIdx, 1);
        if (moved) next.splice(toIdx, 0, moved);
        return {
          databases: {
            ...state.databases,
            [databaseId]: {
              ...bundle,
              columns: next,
              meta: { ...bundle.meta, updatedAt: now() },
            },
          },
        };
      });
      // 컬럼 순서 이동은 레이아웃 조정 성격이라 버전 히스토리에 기록하지 않는다.
      const bundleAfter = get().databases[databaseId];
      if (bundleAfter) enqueueUpsertDatabase(bundleAfter);
    },
  };
}
