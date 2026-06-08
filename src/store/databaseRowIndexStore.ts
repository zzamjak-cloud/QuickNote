import { create } from "zustand";
import {
  normalizeDatabaseRowIndexRows,
  readDatabaseRowIndexCache,
  removeDatabaseRowIndexCache,
  writeDatabaseRowIndexCache,
  type DatabaseRowIndexEntry,
  type DatabaseRowIndexSnapshot,
} from "../lib/database/databaseRowIndexCache";

type DatabaseRowIndexState = {
  snapshotsByKey: Record<string, DatabaseRowIndexSnapshot>;
  hydratedByKey: Record<string, boolean>;
  loadingByKey: Record<string, boolean>;
};

type DatabaseRowIndexActions = {
  hydrateIndex: (indexKey: string) => Promise<void>;
  upsertRows: (
    indexKey: string,
    databaseId: string,
    rows: readonly DatabaseRowIndexEntry[],
    opts?: { reset?: boolean; complete?: boolean },
  ) => Promise<void>;
  removeRows: (indexKey: string, pageIds: readonly string[]) => Promise<void>;
  clearIndex: (indexKey: string) => Promise<void>;
};

export type DatabaseRowIndexStore = DatabaseRowIndexState &
  DatabaseRowIndexActions;

export const useDatabaseRowIndexStore = create<DatabaseRowIndexStore>()(
  (set, get) => ({
    snapshotsByKey: {},
    hydratedByKey: {},
    loadingByKey: {},

    hydrateIndex: async (indexKey) => {
      if (!indexKey || get().hydratedByKey[indexKey] || get().loadingByKey[indexKey]) return;
      set((state) => ({
        loadingByKey: { ...state.loadingByKey, [indexKey]: true },
      }));
      const snapshot = await readDatabaseRowIndexCache(indexKey);
      set((state) => {
        const snapshotsByKey = snapshot
          ? { ...state.snapshotsByKey, [indexKey]: snapshot }
          : state.snapshotsByKey;
        return {
          snapshotsByKey,
          hydratedByKey: { ...state.hydratedByKey, [indexKey]: true },
          loadingByKey: { ...state.loadingByKey, [indexKey]: false },
        };
      });
    },

    upsertRows: async (indexKey, databaseId, rows, opts) => {
      if (!indexKey || (rows.length === 0 && !opts?.reset)) return;
      const current = get().snapshotsByKey[indexKey];
      const nextRows = opts?.reset
        ? normalizeDatabaseRowIndexRows(rows)
        : normalizeDatabaseRowIndexRows([...(current?.rows ?? []), ...rows]);
      const snapshot: DatabaseRowIndexSnapshot = {
        v: current?.v ?? 1,
        indexKey,
        databaseId,
        complete: opts?.complete ?? current?.complete ?? false,
        updatedAt: Date.now(),
        rows: nextRows,
      };
      set((state) => ({
        snapshotsByKey: { ...state.snapshotsByKey, [indexKey]: snapshot },
        hydratedByKey: { ...state.hydratedByKey, [indexKey]: true },
      }));
      await writeDatabaseRowIndexCache(snapshot);
    },

    removeRows: async (indexKey, pageIds) => {
      if (!indexKey || pageIds.length === 0) return;
      const current = get().snapshotsByKey[indexKey];
      if (!current) return;
      const ids = new Set(pageIds);
      const snapshot: DatabaseRowIndexSnapshot = {
        ...current,
        rows: current.rows.filter((row) => !ids.has(row.pageId)),
        updatedAt: Date.now(),
      };
      set((state) => ({
        snapshotsByKey: { ...state.snapshotsByKey, [indexKey]: snapshot },
      }));
      await writeDatabaseRowIndexCache(snapshot);
    },

    clearIndex: async (indexKey) => {
      if (!indexKey) return;
      set((state) => {
        const snapshotsByKey = { ...state.snapshotsByKey };
        const hydratedByKey = { ...state.hydratedByKey };
        const loadingByKey = { ...state.loadingByKey };
        delete snapshotsByKey[indexKey];
        delete hydratedByKey[indexKey];
        delete loadingByKey[indexKey];
        return { snapshotsByKey, hydratedByKey, loadingByKey };
      });
      await removeDatabaseRowIndexCache(indexKey);
    },
  }),
);
