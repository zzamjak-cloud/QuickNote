import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { zustandStorage } from "../lib/storage/index";
import type {
  CellValue,
  ColumnDef,
  ColumnType,
  DatabaseBundle,
  DatabaseMeta,
  DatabaseRowPreset,
  DatabaseTemplate,
} from "../types/database";
import { DATABASE_STORE_VERSION } from "../types/database";
import { newId } from "../lib/id";
import { usePageStore } from "./pageStore";
import { shouldWriteAnchor, useHistoryStore } from "./historyStore";
import { enqueueAsync } from "../lib/sync/runtime";
import { clearLocalDeleteGuard, markLocallyDeletedEntity } from "../lib/sync/localDeleteGuards";
import { useWorkspaceStore } from "./workspaceStore";
import {
  attachPersistedMeta,
  mergePersistedSubset,
  type PersistedQuarantine,
} from "../lib/migrations/persistedStore";
import {
  DATABASE_STORE_DATA_KEYS,
  DATABASE_STORE_PERSIST_VERSION,
  type DbMap,
  migrateDatabaseStore,
} from "./databaseStore/migrations";
import {
  LC_SCHEDULER_DATABASE_TITLE,
  isLCSchedulerDatabaseId,
  isLCSchedulerRequiredColumnId,
} from "../lib/scheduler/database";
import {
  allocateUniqueDatabaseTitle,
  createRowPage,
  defaultCellValueForColumn,
  enqueueUpsertDatabase,
  enqueueUpsertPageRaw,
  extractFullPageDatabaseId,
  getCurrentWorkspaceId,
  isDatabaseTitleTaken,
  isValidDatabaseSnapshot,
  makeReferenceCellValue,
  normalizeDbTitle,
  seedColumns,
  toDatabaseSnapshot,
  toPageSnapshot,
} from "./databaseStore/helpers";
import type { Page } from "../types/page";
import { EMPTY_DOC, nextOrderForParent } from "./pageStore/helpers";

export { migrateDatabaseStore } from "./databaseStore/migrations";
export { normalizeDbTitle } from "./databaseStore/helpers";

function now(): number {
  return Date.now();
}

type DatabaseStoreState = {
  version: number;
  databases: DbMap;
  /** 현재 databases 캐시가 소속된 워크스페이스. null이면 구버전/미확정 캐시로 간주한다. */
  cacheWorkspaceId: string | null;
  /** 자동 복구하지 못한 persisted 원본. 사용자 데이터 안전을 위해 삭제하지 않는다. */
  migrationQuarantine: PersistedQuarantine[];
  /** DB별 템플릿 목록 (로컬 전용). */
  dbTemplates: Record<string, DatabaseTemplate[]>;
};

type DatabaseStoreActions = {
  createDatabase: (title?: string) => string;
  /** 명시적 삭제(페이지에서 블록만 지울 때는 호출하지 않음 — 데이터 유지) */
  deleteDatabase: (id: string) => void;
  /** 성공 시 true. 다른 DB와 동일한 표시 제목(정규화 후)이면 false */
  setDatabaseTitle: (id: string, title: string) => boolean;
  addColumn: (databaseId: string, col: Omit<ColumnDef, "id"> & { id?: string }) => string;
  updateColumn: (
    databaseId: string,
    columnId: string,
    patch: Partial<Pick<ColumnDef, "name" | "type" | "config" | "width">>,
  ) => void;
  removeColumn: (databaseId: string, columnId: string) => void;
  moveColumn: (databaseId: string, fromIdx: number, toIdx: number) => void;
  /** 시드/추가 행을 위한 행 페이지 생성 — 새 페이지 id 반환 */
  addRow: (databaseId: string) => string;
  /** 가져오기 전용 일괄 행 생성 — 단일 setState로 메모리 절약 */
  importRowsBatch: (
    databaseId: string,
    existingSeedPageId: string | null,
    rows: Array<{ title: string; cells: Record<string, CellValue> }>,
  ) => string[];
  deleteRow: (databaseId: string, pageId: string) => void;
  updateCell: (
    databaseId: string,
    pageId: string,
    columnId: string,
    value: CellValue,
  ) => void;
  setRowOrder: (databaseId: string, orderedPageIds: string[]) => void;
  attachPageAsRow: (databaseId: string, pageId: string) => boolean;
  detachRowToNormalPage: (pageId: string) => boolean;
  restoreDatabaseFromLatestHistory: (databaseId: string) => boolean;
  restoreDatabaseFromHistoryEvent: (databaseId: string, eventId: string) => boolean;
  restoreDeletedRowFromHistory: (databaseId: string, tombstoneId: string) => boolean;
  getBundle: (databaseId: string) => DatabaseBundle | undefined;
  /** 스키마·행을 소스와 공유하는지 */
  resolveBundle: (databaseId: string) => DatabaseBundle | undefined;
  /** 빈 템플릿 생성 후 templateId 반환. */
  addTemplate: (databaseId: string) => string;
  /** 템플릿 필드 일부 갱신. */
  updateTemplate: (databaseId: string, templateId: string, patch: Partial<DatabaseTemplate>) => void;
  /** 템플릿 삭제. */
  deleteTemplate: (databaseId: string, templateId: string) => void;
  /** 템플릿을 적용해 새 행 생성 후 새 pageId 반환. */
  applyTemplate: (databaseId: string, templateId: string) => string;
  addPreset: (
    databaseId: string,
    preset?: Partial<Omit<DatabaseRowPreset, "id" | "databaseId" | "createdAt" | "updatedAt">>,
  ) => string;
  updatePreset: (
    databaseId: string,
    presetId: string,
    patch: Partial<Omit<DatabaseRowPreset, "id" | "databaseId" | "createdAt">>,
  ) => void;
  deletePreset: (databaseId: string, presetId: string) => void;
  applyPresetToRow: (databaseId: string, pageId: string, presetId: string) => boolean;
};

export type DatabaseStore = DatabaseStoreState & DatabaseStoreActions;

export const useDatabaseStore = create<DatabaseStore>()(
  persist(
    (set, get) => ({
      version: DATABASE_STORE_VERSION,
      databases: {},
      cacheWorkspaceId: null,
      migrationQuarantine: [],
      dbTemplates: {},

      createDatabase: (title = "새 데이터베이스") => {
        const id = newId();
        const t = now();
        const workspaceId = getCurrentWorkspaceId();
        const cols = seedColumns();
        const seedPageId = createRowPage(id, "항목 1");
        const uniqueTitle = allocateUniqueDatabaseTitle(get().databases, title);

        const bundle: DatabaseBundle = {
          meta: { id, workspaceId: workspaceId || undefined, title: uniqueTitle, createdAt: t, updatedAt: t },
          columns: cols,
          rowPageOrder: [seedPageId],
        };

        set((state) => ({
          databases: { ...state.databases, [id]: bundle },
          cacheWorkspaceId: workspaceId || state.cacheWorkspaceId,
        }));
        const hs = useHistoryStore.getState();
        const events = hs.dbEventsByDatabaseId[id] ?? [];
        hs.recordDbEvent(
          id,
          "db.create",
          toDatabaseSnapshot(bundle),
          shouldWriteAnchor(events.length + 1) ? toDatabaseSnapshot(bundle) : undefined,
        );
        enqueueUpsertDatabase(bundle);
        return id;
      },

      deleteDatabase: (id) => {
        if (isLCSchedulerDatabaseId(id)) return;
        const bundle = get().databases[id];
        if (bundle) {
          for (const pageId of bundle.rowPageOrder) {
            usePageStore.getState().deletePage(pageId);
          }
        }
        set((state) => {
          if (!(id in state.databases)) return state;
          const next = { ...state.databases };
          delete next[id];
          return { databases: next };
        });
        if (bundle) {
          const hs = useHistoryStore.getState();
          const events = hs.dbEventsByDatabaseId[id] ?? [];
          const workspaceId = bundle.meta.workspaceId ?? useWorkspaceStore.getState().currentWorkspaceId ?? "";
          const updatedAt = new Date().toISOString();
          hs.recordDbEvent(
            id,
            "db.delete",
            toDatabaseSnapshot(bundle),
            shouldWriteAnchor(events.length + 1)
              ? toDatabaseSnapshot(bundle)
              : undefined,
          );
          markLocallyDeletedEntity("database", id, workspaceId, Date.parse(updatedAt) || Date.now());
          enqueueAsync("softDeleteDatabase", {
            id,
            workspaceId,
            updatedAt,
          });
        }
      },

      setDatabaseTitle: (id, title) => {
        const state = get();
        const b = state.databases[id];
        if (!b) return false;
        if (isLCSchedulerDatabaseId(id)) {
          return normalizeDbTitle(title) === LC_SCHEDULER_DATABASE_TITLE;
        }
        const nextTitle = normalizeDbTitle(title);
        if (isDatabaseTitleTaken(state.databases, nextTitle, id)) {
          return false;
        }
        set({
          databases: {
            ...state.databases,
            [id]: {
              ...b,
              meta: { ...b.meta, title: nextTitle, updatedAt: now() },
            },
          },
        });
        const bundleAfter = get().databases[id];
        if (bundleAfter) {
          const hs = useHistoryStore.getState();
          const events = hs.dbEventsByDatabaseId[id] ?? [];
          hs.recordDbEvent(
            id,
            "db.title",
            { meta: structuredClone(bundleAfter.meta) },
            shouldWriteAnchor(events.length + 1)
              ? toDatabaseSnapshot(bundleAfter)
              : undefined,
          );
          enqueueUpsertDatabase(bundleAfter);
        }
        // DB 제목 변경 시 해당 DB를 가리키는 buttonBlock 레이블 동기화
        const homePageId = usePageStore.getState().findFullPagePageIdForDatabase(id);
        if (homePageId) {
          usePageStore.getState().updateButtonBlockLabels(homePageId, nextTitle);
        }
        return true;
      },

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
        // 기본값이 있는 컬럼(status 등) 추가 시 기존 행 페이지에도 채움 (페이지 스토어 1회 갱신).
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
        // 직접 mutate 한 행 페이지에 대해 enqueue.
        const pages = usePageStore.getState().pages;
        for (const pid of mutatedRowPageIds) {
          const p = pages[pid];
          if (p) enqueueUpsertPageRaw(p);
        }
        return colId;
      },

      updateColumn: (databaseId, columnId, patch) => {
        let patchForColumn = patch;
        if (
          isLCSchedulerDatabaseId(databaseId) &&
          isLCSchedulerRequiredColumnId(columnId)
        ) {
          const { type: _ignoredType, ...rest } = patch;
          patchForColumn = rest;
        }
        set((state) => {
          const bundle = state.databases[databaseId];
          if (!bundle) return state;
          const next = bundle.columns.map((c) => {
            if (c.id !== columnId) return c;
            // title 컬럼의 type 변경 차단
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
      },

      removeColumn: (databaseId, columnId) => {
        if (
          isLCSchedulerDatabaseId(databaseId) &&
          isLCSchedulerRequiredColumnId(columnId)
        ) {
          return;
        }
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

      addRow: (databaseId) => {
        const bundle = get().databases[databaseId];
        if (!bundle) return "";
        const pageId = createRowPage(
          databaseId,
          `항목 ${bundle.rowPageOrder.length + 1}`,
        );
        // 기본값이 있는 컬럼(status 등)에 시드 값 주입 — 단일 setState.
        const defaults: Record<string, CellValue> = {};
        for (const col of bundle.columns) {
          const def = defaultCellValueForColumn(col);
          if (def != null) defaults[col.id] = def;
        }
        if (Object.keys(defaults).length > 0) {
          const t = Date.now();
          usePageStore.setState((s) => {
            const page = s.pages[pageId];
            if (!page) return s;
            return {
              pages: {
                ...s.pages,
                [pageId]: {
                  ...page,
                  dbCells: { ...(page.dbCells ?? {}), ...defaults },
                  updatedAt: t,
                },
              },
            };
          });
        }
        set((state) => {
          const b = state.databases[databaseId];
          if (!b) return state;
          return {
            databases: {
              ...state.databases,
              [databaseId]: {
                ...b,
                rowPageOrder: [...b.rowPageOrder, pageId],
                meta: { ...b.meta, updatedAt: now() },
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
            "db.row.add",
            { rowPageOrder: [...bundleAfter.rowPageOrder] },
            shouldWriteAnchor(events.length + 1)
              ? toDatabaseSnapshot(bundleAfter)
              : undefined,
          );
          enqueueUpsertDatabase(bundleAfter);
        }
        // 행 페이지 자체는 createRowPage 가 pageStore 에 createPage 로 추가했고,
        // 위 setState 로 dbCells 가 수정됐을 수 있다. 둘 다 enqueue 가 필요하지만
        // dedupe 로 마지막 한 번만 보내진다.
        const newPage = usePageStore.getState().pages[pageId];
        if (newPage) enqueueUpsertPageRaw(newPage);
        return pageId;
      },

      importRowsBatch: (databaseId, existingSeedPageId, rows) => {
        if (rows.length === 0) return [];
        const bundle = get().databases[databaseId];
        if (!bundle) return [];

        const workspaceId = getCurrentWorkspaceId();
        const ts = now();
        const columnDefaults: Record<string, CellValue> = {};
        for (const col of bundle.columns) {
          const def = defaultCellValueForColumn(col);
          if (def != null) columnDefaults[col.id] = def;
        }

        const currentPages = usePageStore.getState().pages;
        const baseOrder = nextOrderForParent(currentPages, null);
        const pageIds: string[] = [];
        const pageUpdates: Record<string, Page> = {};

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (!row) continue;
          const { title, cells } = row;
          const dbCells: Record<string, CellValue> = { ...columnDefaults, ...cells };

          if (i === 0 && existingSeedPageId) {
            pageIds.push(existingSeedPageId);
            const existing = currentPages[existingSeedPageId];
            if (existing) {
              pageUpdates[existingSeedPageId] = { ...existing, title, dbCells, updatedAt: ts };
            }
          } else {
            const pageId = newId();
            pageIds.push(pageId);
            pageUpdates[pageId] = {
              id: pageId,
              workspaceId: workspaceId || undefined,
              title,
              icon: null,
              doc: structuredClone(EMPTY_DOC),
              parentId: null,
              order: baseOrder + i,
              databaseId,
              dbCells,
              createdAt: ts,
              updatedAt: ts,
            };
          }
        }

        // 단일 pageStore setState로 모든 페이지 일괄 반영
        usePageStore.setState((s) => ({ pages: { ...s.pages, ...pageUpdates } }));

        // 신규 행만 rowPageOrder에 추가 (시드 행은 이미 포함됨)
        const newPageIds = existingSeedPageId ? pageIds.slice(1) : pageIds;
        set((state) => {
          const b = state.databases[databaseId];
          if (!b) return state;
          return {
            databases: {
              ...state.databases,
              [databaseId]: {
                ...b,
                rowPageOrder: [...b.rowPageOrder, ...newPageIds],
                meta: { ...b.meta, updatedAt: ts },
              },
            },
          };
        });

        // sync enqueue 일괄 처리
        const pages = usePageStore.getState().pages;
        for (const pageId of pageIds) {
          const page = pages[pageId];
          if (page) enqueueUpsertPageRaw(page);
        }
        const bundleAfter = get().databases[databaseId];
        if (bundleAfter) enqueueUpsertDatabase(bundleAfter);

        return pageIds;
      },

      deleteRow: (databaseId, pageId) => {
        const pageBefore = usePageStore.getState().pages[pageId];
        const rowIdx = get().databases[databaseId]?.rowPageOrder.indexOf(pageId) ?? -1;
        if (pageBefore && rowIdx >= 0) {
          useHistoryStore.getState().recordDeletedRowTombstone({
            databaseId,
            pageId,
            rowIndex: rowIdx,
            pageSnapshot: toPageSnapshot(pageBefore),
          });
        }
        usePageStore.getState().deletePage(pageId);
        set((state) => {
          const bundle = state.databases[databaseId];
          if (!bundle) return state;
          return {
            databases: {
              ...state.databases,
              [databaseId]: {
                ...bundle,
                rowPageOrder: bundle.rowPageOrder.filter((id) => id !== pageId),
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
            "db.row.delete",
            { rowPageOrder: [...bundleAfter.rowPageOrder] },
            shouldWriteAnchor(events.length + 1)
              ? toDatabaseSnapshot(bundleAfter)
              : undefined,
          );
          enqueueUpsertDatabase(bundleAfter);
        }
        // 행 페이지 자체의 softDelete 는 pageStore.deletePage 가 이미 enqueue.
      },

      updateCell: (databaseId, pageId, columnId, value) => {
        const bundle = get().databases[databaseId];
        if (!bundle) return;
        const col = bundle.columns.find((c) => c.id === columnId);
        if (col?.type === "title") {
          const t = typeof value === "string" ? value : "";
          usePageStore.getState().renamePage(pageId, t || "제목 없음");
        } else {
          usePageStore.getState().setPageDbCell(pageId, columnId, value);
        }
        set((state) => {
          const b = state.databases[databaseId];
          if (!b) return state;
          return {
            databases: {
              ...state.databases,
              [databaseId]: { ...b, meta: { ...b.meta, updatedAt: now() } },
            },
          };
        });
        // 셀 값 변경은 "행 페이지"의 내용 변경으로 본다.
        // DB 히스토리에는 남기지 않고, pageStore(setPageDbCell/renamePage)의
        // 페이지 히스토리로만 기록한다.
      },

      setRowOrder: (databaseId, orderedPageIds) => {
        set((state) => {
          const bundle = state.databases[databaseId];
          if (!bundle) return state;
          const set_ = new Set(bundle.rowPageOrder);
          return {
            databases: {
              ...state.databases,
              [databaseId]: {
                ...bundle,
                rowPageOrder: orderedPageIds.filter((id) => set_.has(id)),
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
            "db.row.order",
            { rowPageOrder: [...bundleAfter.rowPageOrder] },
            shouldWriteAnchor(events.length + 1)
              ? toDatabaseSnapshot(bundleAfter)
              : undefined,
          );
          enqueueUpsertDatabase(bundleAfter);
        }
      },

      attachPageAsRow: (databaseId, pageId) => {
        const targetDb = get().databases[databaseId];
        const pageBefore = usePageStore.getState().pages[pageId];
        if (!targetDb || !pageBefore) return false;
        const sourceFullPageDbId = extractFullPageDatabaseId(pageBefore);
        // 권장 3: DB 페이지는 다른 DB로 실삽입하지 않고 "참조 행"만 생성.
        if (sourceFullPageDbId) {
          if (sourceFullPageDbId === databaseId) return false;
          const refPageId = createRowPage(
            databaseId,
            pageBefore.title || "DB 참조",
          );
          const defaultCells: Record<string, CellValue> = {};
          for (const col of targetDb.columns) {
            if (col.type === "title") continue;
            const def = defaultCellValueForColumn(col);
            defaultCells[col.id] = def ?? null;
          }
          const refCells = makeReferenceCellValue(
            targetDb.columns,
            sourceFullPageDbId,
            pageBefore.title || "데이터베이스",
          );
          const nextCells = { ...defaultCells, ...refCells };

          usePageStore.setState((s) => {
            const page = s.pages[refPageId];
            if (!page) return s;
            return {
              pages: {
                ...s.pages,
                [refPageId]: {
                  ...page,
                  databaseId,
                  dbCells: nextCells,
                  parentId: null,
                  updatedAt: now(),
                },
              },
            };
          });

          set((state) => {
            const db = state.databases[databaseId];
            if (!db) return state;
            return {
              databases: {
                ...state.databases,
                [databaseId]: {
                  ...db,
                  rowPageOrder: [...db.rowPageOrder, refPageId],
                  meta: { ...db.meta, updatedAt: now() },
                },
              },
            };
          });

          const hs = useHistoryStore.getState();
          const refPageAfter = usePageStore.getState().pages[refPageId];
          const dbAfter = get().databases[databaseId];
          if (refPageAfter) {
            const pageEvents = hs.pageEventsByPageId[refPageId] ?? [];
            hs.recordPageEvent(
              refPageId,
              "page.dbCell",
              { id: refPageId, databaseId, dbCells: structuredClone(nextCells) },
              shouldWriteAnchor(pageEvents.length + 1)
                ? toPageSnapshot(refPageAfter)
                : undefined,
            );
          }
          if (dbAfter) {
            const dbEvents = hs.dbEventsByDatabaseId[databaseId] ?? [];
            hs.recordDbEvent(
              databaseId,
              "db.row.add",
              { rowPageOrder: [...dbAfter.rowPageOrder] },
              shouldWriteAnchor(dbEvents.length + 1)
                ? toDatabaseSnapshot(dbAfter)
                : undefined,
            );
            enqueueUpsertDatabase(dbAfter);
          }
          if (refPageAfter) enqueueUpsertPageRaw(refPageAfter);
          return true;
        }

        const fromDbId = pageBefore.databaseId;
        const fromDb =
          fromDbId && fromDbId !== databaseId ? get().databases[fromDbId] : undefined;

        // 대상 DB의 컬럼 기준으로 기본 속성값 준비(제목 컬럼 제외).
        const defaultCells: Record<string, CellValue> = {};
        for (const col of targetDb.columns) {
          if (col.type === "title") continue;
          const def = defaultCellValueForColumn(col);
          defaultCells[col.id] = def ?? null;
        }
        const nextCells = { ...defaultCells, ...(pageBefore.dbCells ?? {}) };

        usePageStore.setState((s) => {
          const page = s.pages[pageId];
          if (!page) return s;
          return {
            pages: {
              ...s.pages,
              [pageId]: {
                ...page,
                databaseId,
                dbCells: nextCells,
                // DB 항목으로 편입되면 사이드바 트리 경로(부모 체인)에서 분리한다.
                // 그렇지 않으면 TopBar breadcrumb가 이전 부모 경로를 계속 보여준다.
                parentId: null,
                updatedAt: now(),
              },
            },
          };
        });

        set((state) => {
          const nextDatabases = { ...state.databases };
          const currentTarget = nextDatabases[databaseId];
          if (!currentTarget) return state;

          if (fromDb && fromDbId) {
            nextDatabases[fromDbId] = {
              ...fromDb,
              rowPageOrder: fromDb.rowPageOrder.filter((id) => id !== pageId),
              meta: { ...fromDb.meta, updatedAt: now() },
            };
          }

          const deduped = currentTarget.rowPageOrder.filter((id) => id !== pageId);
          nextDatabases[databaseId] = {
            ...currentTarget,
            rowPageOrder: [...deduped, pageId],
            meta: { ...currentTarget.meta, updatedAt: now() },
          };
          return { databases: nextDatabases };
        });

        const hs = useHistoryStore.getState();
        const pageAfter = usePageStore.getState().pages[pageId];
        const targetAfter = get().databases[databaseId];
        if (pageAfter) {
          const pageEvents = hs.pageEventsByPageId[pageId] ?? [];
          hs.recordPageEvent(
            pageId,
            "page.dbCell",
            { id: pageId, databaseId, dbCells: structuredClone(nextCells) },
            shouldWriteAnchor(pageEvents.length + 1)
              ? toPageSnapshot(pageAfter)
              : undefined,
          );
        }
        if (targetAfter) {
          const targetEvents = hs.dbEventsByDatabaseId[databaseId] ?? [];
          hs.recordDbEvent(
            databaseId,
            "db.row.add",
            { rowPageOrder: [...targetAfter.rowPageOrder] },
            shouldWriteAnchor(targetEvents.length + 1)
              ? toDatabaseSnapshot(targetAfter)
              : undefined,
          );
          enqueueUpsertDatabase(targetAfter);
        }
        if (fromDbId && fromDbId !== databaseId) {
          const oldAfter = get().databases[fromDbId];
          if (oldAfter) {
            const oldEvents = hs.dbEventsByDatabaseId[fromDbId] ?? [];
            hs.recordDbEvent(
              fromDbId,
              "db.row.delete",
              { rowPageOrder: [...oldAfter.rowPageOrder] },
              shouldWriteAnchor(oldEvents.length + 1)
                ? toDatabaseSnapshot(oldAfter)
                : undefined,
            );
            enqueueUpsertDatabase(oldAfter);
          }
        }
        if (pageAfter) enqueueUpsertPageRaw(pageAfter);
        return true;
      },

      detachRowToNormalPage: (pageId) => {
        const pageBefore = usePageStore.getState().pages[pageId];
        const fromDbId = pageBefore?.databaseId;
        if (!pageBefore || !fromDbId) return false;
        const fromDb = get().databases[fromDbId];
        if (!fromDb) return false;

        usePageStore.setState((s) => {
          const page = s.pages[pageId];
          if (!page) return s;
          return {
            pages: {
              ...s.pages,
              [pageId]: {
                ...page,
                databaseId: undefined,
                dbCells: undefined,
                updatedAt: now(),
              },
            },
          };
        });

        set((state) => {
          const db = state.databases[fromDbId];
          if (!db) return state;
          return {
            databases: {
              ...state.databases,
              [fromDbId]: {
                ...db,
                rowPageOrder: db.rowPageOrder.filter((id) => id !== pageId),
                meta: { ...db.meta, updatedAt: now() },
              },
            },
          };
        });

        const hs = useHistoryStore.getState();
        const pageAfter = usePageStore.getState().pages[pageId];
        const dbAfter = get().databases[fromDbId];
        if (pageAfter) {
          const pageEvents = hs.pageEventsByPageId[pageId] ?? [];
          hs.recordPageEvent(
            pageId,
            "page.dbCell",
            { id: pageId, databaseId: undefined, dbCells: undefined },
            shouldWriteAnchor(pageEvents.length + 1)
              ? toPageSnapshot(pageAfter)
              : undefined,
          );
        }
        if (dbAfter) {
          const dbEvents = hs.dbEventsByDatabaseId[fromDbId] ?? [];
          hs.recordDbEvent(
            fromDbId,
            "db.row.delete",
            { rowPageOrder: [...dbAfter.rowPageOrder] },
            shouldWriteAnchor(dbEvents.length + 1)
              ? toDatabaseSnapshot(dbAfter)
              : undefined,
          );
          enqueueUpsertDatabase(dbAfter);
        }
        if (pageAfter) enqueueUpsertPageRaw(pageAfter);
        return true;
      },

      restoreDatabaseFromLatestHistory: (databaseId) => {
        const snapshot = useHistoryStore.getState().getLatestDbSnapshot(databaseId);
        if (!isValidDatabaseSnapshot(snapshot)) return false;
        // 사용자가 명시적으로 복원 → 이전 삭제 가드(영구 tombstone 포함) 제거.
        const restoreWs = snapshot.meta?.workspaceId ?? getCurrentWorkspaceId();
        if (restoreWs) clearLocalDeleteGuard("database", databaseId, restoreWs);
        set((state) => ({
          databases: {
            ...state.databases,
            [databaseId]: {
              ...structuredClone(snapshot),
              meta: {
                ...structuredClone(snapshot.meta),
                updatedAt: Date.now(),
              },
            },
          },
        }));
        // DB 삭제 후 복원 시 row 페이지가 누락될 수 있어, 페이지 히스토리 스냅샷으로 함께 복원.
        const restoredPageIds: string[] = [];
        usePageStore.setState((s) => {
          const nextPages = { ...s.pages };
          let changed = false;
          const hs = useHistoryStore.getState();
          for (const pageId of snapshot.rowPageOrder) {
            if (nextPages[pageId]) continue;
            const pageSnap = hs.getLatestPageSnapshot(pageId);
            if (!pageSnap) continue;
            nextPages[pageId] = {
              ...structuredClone(pageSnap),
              databaseId,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            restoredPageIds.push(pageId);
            changed = true;
          }
          return changed ? { pages: nextPages } : s;
        });
        const bundleAfter = get().databases[databaseId];
        if (bundleAfter) enqueueUpsertDatabase(bundleAfter);
        const pages = usePageStore.getState().pages;
        for (const pid of restoredPageIds) {
          const p = pages[pid];
          if (p) enqueueUpsertPageRaw(p);
        }
        return true;
      },

      restoreDatabaseFromHistoryEvent: (databaseId, eventId) => {
        const snapshot = useHistoryStore
          .getState()
          .getDbSnapshotAtEvent(databaseId, eventId);
        if (!isValidDatabaseSnapshot(snapshot)) return false;
        // 사용자가 명시적으로 복원 → 이전 삭제 가드(영구 tombstone 포함) 제거.
        const restoreWs = snapshot.meta?.workspaceId ?? getCurrentWorkspaceId();
        if (restoreWs) clearLocalDeleteGuard("database", databaseId, restoreWs);
        set((state) => ({
          databases: {
            ...state.databases,
            [databaseId]: {
              ...structuredClone(snapshot),
              meta: {
                ...structuredClone(snapshot.meta),
                updatedAt: Date.now(),
              },
            },
          },
        }));
        const restoredPageIds: string[] = [];
        usePageStore.setState((s) => {
          const nextPages = { ...s.pages };
          let changed = false;
          const hs = useHistoryStore.getState();
          for (const pageId of snapshot.rowPageOrder) {
            if (nextPages[pageId]) continue;
            const pageSnap = hs.getLatestPageSnapshot(pageId);
            if (!pageSnap) continue;
            nextPages[pageId] = {
              ...structuredClone(pageSnap),
              databaseId,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            restoredPageIds.push(pageId);
            changed = true;
          }
          return changed ? { pages: nextPages } : s;
        });
        const bundleAfter = get().databases[databaseId];
        if (bundleAfter) enqueueUpsertDatabase(bundleAfter);
        const pages = usePageStore.getState().pages;
        for (const pid of restoredPageIds) {
          const p = pages[pid];
          if (p) enqueueUpsertPageRaw(p);
        }
        return true;
      },

      restoreDeletedRowFromHistory: (databaseId, tombstoneId) => {
        const tombstone = useHistoryStore
          .getState()
          .popDeletedRowTombstone(databaseId, tombstoneId);
        if (!tombstone) return false;

        usePageStore.setState((s) => ({
          pages: {
            ...s.pages,
            [tombstone.pageId]: {
              ...structuredClone(tombstone.pageSnapshot),
              createdAt: s.pages[tombstone.pageId]?.createdAt ?? Date.now(),
              updatedAt: Date.now(),
            },
          },
        }));

        set((state) => {
          const b = state.databases[databaseId];
          if (!b) return state;
          const order = [...b.rowPageOrder];
          const idx = Math.max(0, Math.min(tombstone.rowIndex, order.length));
          order.splice(idx, 0, tombstone.pageId);
          return {
            databases: {
              ...state.databases,
              [databaseId]: {
                ...b,
                rowPageOrder: order,
                meta: { ...b.meta, updatedAt: now() },
              },
            },
          };
        });
        const bundleAfter = get().databases[databaseId];
        if (bundleAfter) enqueueUpsertDatabase(bundleAfter);
        const restoredPage = usePageStore.getState().pages[tombstone.pageId];
        if (restoredPage) enqueueUpsertPageRaw(restoredPage);
        return true;
      },

      addPreset: (databaseId, presetPatch) => {
        const id = newId();
        const t = now();
        const preset: DatabaseRowPreset = {
          id,
          databaseId,
          name: presetPatch?.name ?? "새 프리셋",
          description: presetPatch?.description,
          scope: presetPatch?.scope ?? "workspace",
          scopeId: presetPatch?.scopeId,
          columnDefaults: structuredClone(presetPatch?.columnDefaults ?? {}),
          requiredColumnIds: [...(presetPatch?.requiredColumnIds ?? [])],
          visibleColumnIds: [...(presetPatch?.visibleColumnIds ?? [])],
          hiddenColumnIds: [...(presetPatch?.hiddenColumnIds ?? [])],
          schedulerDefaults: presetPatch?.schedulerDefaults
            ? structuredClone(presetPatch.schedulerDefaults)
            : undefined,
          createdAt: t,
          updatedAt: t,
        };
        set((state) => {
          const b = state.databases[databaseId];
          if (!b) return state;
          return {
            databases: {
              ...state.databases,
              [databaseId]: {
                ...b,
                presets: [...(b.presets ?? []), preset],
                meta: { ...b.meta, updatedAt: t },
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
            "db.preset",
            { presets: structuredClone(bundleAfter.presets ?? []) },
            shouldWriteAnchor(events.length + 1) ? toDatabaseSnapshot(bundleAfter) : undefined,
          );
          enqueueUpsertDatabase(bundleAfter);
        }
        return id;
      },

      updatePreset: (databaseId, presetId, patch) => {
        const t = now();
        set((state) => {
          const b = state.databases[databaseId];
          if (!b) return state;
          return {
            databases: {
              ...state.databases,
              [databaseId]: {
                ...b,
                presets: (b.presets ?? []).map((preset) =>
                  preset.id === presetId
                    ? { ...preset, ...structuredClone(patch), updatedAt: t }
                    : preset,
                ),
                meta: { ...b.meta, updatedAt: t },
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
            "db.preset",
            { presets: structuredClone(bundleAfter.presets ?? []) },
            shouldWriteAnchor(events.length + 1) ? toDatabaseSnapshot(bundleAfter) : undefined,
          );
          enqueueUpsertDatabase(bundleAfter);
        }
      },

      deletePreset: (databaseId, presetId) => {
        set((state) => {
          const b = state.databases[databaseId];
          if (!b) return state;
          return {
            databases: {
              ...state.databases,
              [databaseId]: {
                ...b,
                presets: (b.presets ?? []).filter((preset) => preset.id !== presetId),
                meta: { ...b.meta, updatedAt: now() },
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
            "db.preset",
            { presets: structuredClone(bundleAfter.presets ?? []) },
            shouldWriteAnchor(events.length + 1) ? toDatabaseSnapshot(bundleAfter) : undefined,
          );
          enqueueUpsertDatabase(bundleAfter);
        }
      },

      applyPresetToRow: (databaseId, pageId, presetId) => {
        const bundle = get().databases[databaseId];
        const preset = bundle?.presets?.find((item) => item.id === presetId);
        if (!preset) return false;
        const titleColumn = bundle?.columns.find((column) => column.type === "title");
        const titleValue = titleColumn
          ? preset.columnDefaults[titleColumn.id]
          : undefined;
        const cellDefaults = { ...structuredClone(preset.columnDefaults) };
        if (titleColumn) delete cellDefaults[titleColumn.id];
        const t = Date.now();
        usePageStore.setState((s) => {
          const page = s.pages[pageId];
          if (!page || page.databaseId !== databaseId) return s;
          return {
            pages: {
              ...s.pages,
              [pageId]: {
                ...page,
                title: typeof titleValue === "string" && titleValue.trim()
                  ? titleValue.trim()
                  : page.title,
                dbCells: {
                  ...(page.dbCells ?? {}),
                  ...cellDefaults,
                },
                updatedAt: t,
              },
            },
          };
        });
        const pageAfter = usePageStore.getState().pages[pageId];
        if (pageAfter) {
          enqueueUpsertPageRaw(pageAfter);
        }
        return true;
      },

      addTemplate: (databaseId) => {
      const id = newId();
      // 템플릿 전용 페이지 생성 — dbCells에 마커를 심어 행과 구분한다.
      const pageId = createRowPage(databaseId, "새 템플릿");
      const t = Date.now();
      usePageStore.setState((s) => {
        const page = s.pages[pageId];
        if (!page) return s;
        return {
          pages: {
            ...s.pages,
            [pageId]: {
              ...page,
              dbCells: { ...(page.dbCells ?? {}), _qn_isTemplate: "1" },
              updatedAt: t,
            },
          },
        };
      });
      const page = usePageStore.getState().pages[pageId];
      if (page) enqueueUpsertPageRaw(page);
      const tmpl: DatabaseTemplate = { id, title: "새 템플릿", cells: {}, pageId };
      set((state) => ({
        dbTemplates: {
          ...state.dbTemplates,
          [databaseId]: [...(state.dbTemplates[databaseId] ?? []), tmpl],
        },
      }));
      return pageId;
    },

    updateTemplate: (databaseId, templateId, patch) => {
      set((state) => {
        const list = state.dbTemplates[databaseId] ?? [];
        return {
          dbTemplates: {
            ...state.dbTemplates,
            [databaseId]: list.map((t) =>
              t.id === templateId ? { ...t, ...patch } : t,
            ),
          },
        };
      });
    },

    deleteTemplate: (databaseId, templateId) => {
      const tmpl = (get().dbTemplates[databaseId] ?? []).find((t) => t.id === templateId);
      // 연결된 템플릿 페이지도 함께 삭제.
      if (tmpl?.pageId) {
        usePageStore.getState().deletePage(tmpl.pageId);
      }
      set((state) => {
        const list = state.dbTemplates[databaseId] ?? [];
        return {
          dbTemplates: {
            ...state.dbTemplates,
            [databaseId]: list.filter((t) => t.id !== templateId),
          },
        };
      });
    },

    applyTemplate: (databaseId, templateId) => {
      const bundle = get().databases[databaseId];
      if (!bundle) return "";
      const tmpl = (get().dbTemplates[databaseId] ?? []).find(
        (t) => t.id === templateId,
      );
      // 템플릿 페이지가 있으면 실제 페이지의 셀 값을 복사한다.
      const templatePage = tmpl?.pageId
        ? usePageStore.getState().pages[tmpl.pageId]
        : null;
      const rawTemplateCells = templatePage?.dbCells ?? tmpl?.cells ?? {};
      // _qn_isTemplate 마커는 새 행에 복사하지 않는다.
      const templateCells: Record<string, CellValue> = {};
      for (const [k, v] of Object.entries(rawTemplateCells)) {
        if (k !== "_qn_isTemplate") templateCells[k] = v as CellValue;
      }
      const templateTitle = templatePage?.title ?? tmpl?.title;
      const baseTitle =
        templateTitle && templateTitle !== "새 템플릿"
          ? templateTitle
          : `항목 ${bundle.rowPageOrder.length + 1}`;
      // 기존 행 제목과 중복 시 (1), (2), ... 접미사 추가.
      const existingTitles = new Set(
        bundle.rowPageOrder
          .map((id) => usePageStore.getState().pages[id]?.title)
          .filter(Boolean),
      );
      let uniqueTitle = baseTitle;
      if (existingTitles.has(uniqueTitle)) {
        let n = 1;
        while (existingTitles.has(`${baseTitle} (${n})`)) n++;
        uniqueTitle = `${baseTitle} (${n})`;
      }
      const pageId = createRowPage(databaseId, uniqueTitle);
      // 기본값 컬럼 + 템플릿 셀 값 병합 주입.
      const defaults: Record<string, CellValue> = {};
      for (const col of bundle.columns) {
        const def = defaultCellValueForColumn(col);
        if (def != null) defaults[col.id] = def;
      }
      const cells = { ...defaults, ...templateCells };
      if (Object.keys(cells).length > 0) {
        const t = Date.now();
        usePageStore.setState((s) => {
          const page = s.pages[pageId];
          if (!page) return s;
          return {
            pages: {
              ...s.pages,
              [pageId]: {
                ...page,
                dbCells: { ...(page.dbCells ?? {}), ...cells },
                updatedAt: t,
              },
            },
          };
        });
      }
      set((state) => {
        const b = state.databases[databaseId];
        if (!b) return state;
        return {
          databases: {
            ...state.databases,
            [databaseId]: {
              ...b,
              rowPageOrder: [...b.rowPageOrder, pageId],
              meta: { ...b.meta, updatedAt: now() },
            },
          },
        };
      });
      const bundleAfter = get().databases[databaseId];
      if (bundleAfter) enqueueUpsertDatabase(bundleAfter);
      return pageId;
    },

    getBundle: (databaseId) => get().databases[databaseId],
    resolveBundle: (databaseId) => get().getBundle(databaseId),
    }),
    {
      name: "quicknote.databases.v1",
      storage: createJSONStorage(() => zustandStorage),
      version: DATABASE_STORE_PERSIST_VERSION,
      migrate: migrateDatabaseStore,
      partialize: (state) =>
        attachPersistedMeta(
          {
            databases: state.databases,
            cacheWorkspaceId: state.cacheWorkspaceId,
            migrationQuarantine: state.migrationQuarantine,
            dbTemplates: state.dbTemplates,
          },
          {
            schemaVersion: DATABASE_STORE_PERSIST_VERSION,
            persistedWorkspaceId: state.cacheWorkspaceId,
          },
        ),
      merge: (persisted, current) =>
        mergePersistedSubset(
          persisted,
          current as DatabaseStore,
          DATABASE_STORE_DATA_KEYS,
        ),
    }
  )
);

export function listDatabases(state: DatabaseStore): { id: string; meta: DatabaseMeta }[] {
  const currentWorkspaceId = useWorkspaceStore.getState().currentWorkspaceId;
  return Object.entries(state.databases)
    .filter(([id, bundle]) => {
      if (isLCSchedulerDatabaseId(id)) return true;
      const workspaceId = bundle.meta.workspaceId;
      return !currentWorkspaceId || !workspaceId || workspaceId === currentWorkspaceId;
    })
    .map(([id, b]) => ({ id, meta: b.meta }))
    .sort((a, b) => {
      const aScheduler = isLCSchedulerDatabaseId(a.id);
      const bScheduler = isLCSchedulerDatabaseId(b.id);
      if (aScheduler !== bScheduler) return aScheduler ? -1 : 1;
      return b.meta.updatedAt - a.meta.updatedAt;
    });
}

/** 속성 추가 시 타입별 기본 컬럼 정의 */
export function defaultColumnForType(type: ColumnType, name: string): Omit<ColumnDef, "id"> {
  const base = { name, type };
  if (type === "status") {
    return {
      ...base,
      config: {
        options: [
          { id: newId(), label: "시작전", color: "#94a3b8" },
          { id: newId(), label: "진행중", color: "#3b82f6" },
          { id: newId(), label: "완료", color: "#10b981" },
          { id: newId(), label: "보류", color: "#f59e0b" },
        ],
      },
    };
  }
  if (type === "select" || type === "multiSelect") {
    const opt = (label: string) => ({ id: newId(), label });
    return { ...base, config: { options: [opt("옵션 1"), opt("옵션 2")] } };
  }
  if (type === "date") return { ...base, config: { dateShowEnd: true } };
  return base;
}
