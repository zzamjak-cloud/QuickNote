import type { StoreApi } from "zustand";
import type { CellValue } from "../../../types/database";
import type { Page } from "../../../types/page";
import type { DatabaseStore } from "../../databaseStore";
import { newId } from "../../../lib/id";
import { usePageStore } from "../../pageStore";
import {
  useHistoryStore,
  recordDbMutation,
  recordPageMutation,
} from "../../historyStore";
import { enqueueAsync } from "../../../lib/sync/runtime";
import {
  clearLocalDeleteGuard,
  markLocallyDeletedEntity,
} from "../../../lib/sync/localDeleteGuards";
import {
  writeCellsToCollabDoc,
  deleteRowFromCollabDoc,
} from "../../../lib/collab/dbCellsCollab";
import { useDatabaseRowIndexStore } from "../../databaseRowIndexStore";
import { EMPTY_DOC, nextOrderForParent } from "../../pageStore/helpers";
import {
  createRowPage,
  defaultCellValueForColumn,
  enqueueUpsertDatabase,
  enqueueUpsertPageRaw,
  extractFullPageDatabaseId,
  getCurrentWorkspaceId,
  makeReferenceCellValue,
  seedDefaultsForFilters,
  toDatabaseSnapshot,
  toPageSnapshot,
} from "../helpers";

type DatabaseStoreSet = StoreApi<DatabaseStore>["setState"];
type DatabaseStoreGet = StoreApi<DatabaseStore>["getState"];

type RowActions = Pick<
  DatabaseStore,
  | "addRow"
  | "importRowsBatch"
  | "deleteRow"
  | "updateCell"
  | "updatePageLinkCell"
  | "setRowOrder"
  | "attachPageAsRow"
  | "detachRowToNormalPage"
  | "restoreDeletedRowFromHistory"
>;

function now(): number {
  return Date.now();
}

export function createRowActions(
  set: DatabaseStoreSet,
  get: DatabaseStoreGet,
): RowActions {
  return {
    addRow: (databaseId, seedFilters) => {
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
      // 필터가 걸린 상태에서 추가한 행이 곧바로 보이도록, 활성 필터를
      // 통과하는 값을 해당 컬럼에 주입한다(기본값보다 우선).
      // 파생(자동화) 컬럼은 소스 pageLink 연결로 처리되므로 store 데이터가 필요하다.
      if (seedFilters && seedFilters.length > 0) {
        const seeded = seedDefaultsForFilters(
          bundle,
          seedFilters,
          get().databases,
          usePageStore.getState().pages,
        );
        Object.assign(defaults, seeded);
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
      // 협업 ON: 신규 행 셀을 Y rows 로 시드(빈 defaults 라도 inner map 생성 → 동시편집 병합 보장).
      // 비협업이면 writeCellsToCollabDoc 가 false(no-op) → 기존 페이지 upsert 경로 유지.
      writeCellsToCollabDoc(databaseId, pageId, defaults);
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
        recordDbMutation(
          databaseId,
          "db.row.add",
          { rowPageOrder: [...bundleAfter.rowPageOrder] },
          () => toDatabaseSnapshot(bundleAfter),
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
      // 협업 ON: 가져온 각 행의 셀도 Y rows 로 시드(비협업이면 no-op).
      for (const pageId of pageIds) {
        const cells = pageUpdates[pageId]?.dbCells;
        if (cells) writeCellsToCollabDoc(databaseId, pageId, cells);
      }

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
      // cached-only 행(pageStore 에 실제 페이지가 없고 row-index fallback 으로만 표시되는 행)은
      // deletePage 가 no-op 이라 tombstone/서버 softDelete/row-index prune 이 모두 누락된다.
      // → 삭제해도 row-index 에 남아 유령으로 계속 보이고(중복 포함) 제거할 방법이 없어진다. 직접 처리.
      if (!pageBefore) {
        const indexState = useDatabaseRowIndexStore.getState();
        let rowWorkspaceId: string | null = null;
        for (const snap of Object.values(indexState.snapshotsByKey)) {
          const hit = snap.rows.find((r) => r.pageId === pageId);
          if (hit) {
            rowWorkspaceId = hit.workspaceId;
            break;
          }
        }
        const ws =
          rowWorkspaceId ??
          get().databases[databaseId]?.meta.workspaceId ??
          getCurrentWorkspaceId();
        markLocallyDeletedEntity("page", pageId, ws);
        void indexState.removePagesFromAllIndexes([pageId]);
        enqueueAsync("softDeletePage", {
          id: pageId,
          workspaceId: ws,
          updatedAt: new Date().toISOString(),
        });
      }
      const bundleAfter = get().databases[databaseId];
      if (bundleAfter) {
        recordDbMutation(
          databaseId,
          "db.row.delete",
          { rowPageOrder: [...bundleAfter.rowPageOrder] },
          () => toDatabaseSnapshot(bundleAfter),
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

    updatePageLinkCell: (databaseId, rowPageId, columnId, nextPageIds) => {
      const bundle = get().databases[databaseId];
      if (!bundle) return;

      const pageStore = usePageStore.getState();
      pageStore.setPageDbCell(rowPageId, columnId, nextPageIds);
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
        recordDbMutation(
          databaseId,
          "db.row.order",
          { rowPageOrder: [...bundleAfter.rowPageOrder] },
          () => toDatabaseSnapshot(bundleAfter),
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

        const refPageAfter = usePageStore.getState().pages[refPageId];
        const dbAfter = get().databases[databaseId];
        if (refPageAfter) {
          recordPageMutation(
            refPageId,
            "page.dbCell",
            { id: refPageId, databaseId, dbCells: structuredClone(nextCells) },
            () => toPageSnapshot(refPageAfter),
          );
        }
        if (dbAfter) {
          recordDbMutation(
            databaseId,
            "db.row.add",
            { rowPageOrder: [...dbAfter.rowPageOrder] },
            () => toDatabaseSnapshot(dbAfter),
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

      const pageAfter = usePageStore.getState().pages[pageId];
      const targetAfter = get().databases[databaseId];
      if (pageAfter) {
        recordPageMutation(
          pageId,
          "page.dbCell",
          { id: pageId, databaseId, dbCells: structuredClone(nextCells) },
          () => toPageSnapshot(pageAfter),
        );
      }
      if (targetAfter) {
        recordDbMutation(
          databaseId,
          "db.row.add",
          { rowPageOrder: [...targetAfter.rowPageOrder] },
          () => toDatabaseSnapshot(targetAfter),
        );
        enqueueUpsertDatabase(targetAfter);
      }
      if (fromDbId && fromDbId !== databaseId) {
        const oldAfter = get().databases[fromDbId];
        if (oldAfter) {
          recordDbMutation(
            fromDbId,
            "db.row.delete",
            { rowPageOrder: [...oldAfter.rowPageOrder] },
            () => toDatabaseSnapshot(oldAfter),
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

      // 행이 더 이상 이 DB 소속이 아니므로 DB Y룸 rows 맵에서 제거한다.
      // (안 하면 materialize 가 Y룸의 남은 행을 store 로 되살려 유령 행이 됨 — 전환된 페이지는
      // 삭제가 아니라 살아 있어 tombstone 으로 걸러지지도 않는다.)
      deleteRowFromCollabDoc(fromDbId, pageId);
      // 행 인덱스 폴백 캐시도 prune — 검색/멘션/뷰 재구성 시 유령 행 재유입 차단.
      void useDatabaseRowIndexStore.getState().removePagesFromAllIndexes([pageId]);

      const pageAfter = usePageStore.getState().pages[pageId];
      const dbAfter = get().databases[fromDbId];
      if (pageAfter) {
        recordPageMutation(
          pageId,
          "page.dbCell",
          { id: pageId, databaseId: undefined, dbCells: undefined },
          () => toPageSnapshot(pageAfter),
        );
      }
      if (dbAfter) {
        recordDbMutation(
          fromDbId,
          "db.row.delete",
          { rowPageOrder: [...dbAfter.rowPageOrder] },
          () => toDatabaseSnapshot(dbAfter),
        );
        enqueueUpsertDatabase(dbAfter);
      }
      if (pageAfter) enqueueUpsertPageRaw(pageAfter);
      return true;
    },

    restoreDeletedRowFromHistory: (databaseId, tombstoneId) => {
      const tombstone = useHistoryStore
        .getState()
        .popDeletedRowTombstone(databaseId, tombstoneId);
      if (!tombstone) return false;

      // 명시적 복원 → 페이지 삭제 가드 해제(없으면 enqueue 한 복원본이 sync 에서 다시 무시됨).
      const restoreWs = tombstone.workspaceId ?? getCurrentWorkspaceId();
      if (restoreWs) clearLocalDeleteGuard("page", tombstone.pageId, restoreWs);

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
  };
}
