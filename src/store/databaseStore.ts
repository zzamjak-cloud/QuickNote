import { create } from "zustand";
import type {
  CellValue,
  ColumnDef,
  ColumnType,
  DatabaseBundle,
  DatabaseMeta,
} from "../types/database";
import { DATABASE_STORE_VERSION } from "../types/database";
import { newId } from "../lib/id";
import { createRowPageLinkedToDatabase } from "../lib/services/databaseRowPages";
import { usePageStore } from "./pageStore";
import { shouldWriteAnchor, useHistoryStore } from "./historyStore";
import type { DatabaseSnapshot, PageSnapshot } from "../types/history";
import { enqueueAsync } from "../lib/sync/runtime";
import { useAuthStore } from "./authStore";
import { useWorkspaceStore } from "./workspaceStore";
import type { Page } from "../types/page";

// v5 fallback: 아직 memberStore(me.memberId)와 완전 연동 전이라 auth sub 를 사용.
function getCreatedByMemberId(): string {
  const s = useAuthStore.getState().state;
  return s.status === "authenticated" ? s.user.sub : "";
}

function getCurrentWorkspaceId(): string {
  return useWorkspaceStore.getState().currentWorkspaceId ?? "";
}

// 클라이언트 number(epoch ms) → GraphQL 경계 ISO 문자열 변환
function toGqlDatabase(
  meta: DatabaseMeta,
  columns: ColumnDef[],
  createdByMemberId: string,
): Record<string, unknown> {
  return {
    id: meta.id,
    workspaceId: getCurrentWorkspaceId(),
    createdByMemberId,
    title: meta.title,
    columns,
    createdAt: new Date(meta.createdAt).toISOString(),
    updatedAt: new Date(meta.updatedAt).toISOString(),
  };
}

function enqueueUpsertDatabase(bundle: DatabaseBundle): void {
  const payload = toGqlDatabase(bundle.meta, bundle.columns, getCreatedByMemberId());
  enqueueAsync(
    "upsertDatabase",
    payload as Record<string, unknown> & { id: string; updatedAt?: string },
  );
}

// 행 페이지를 직접 mutate 한 경우 페이지 enqueue 를 보조해주는 헬퍼.
function enqueueUpsertPageRaw(p: Page): void {
  const createdByMemberId = getCreatedByMemberId();
  enqueueAsync(
    "upsertPage",
    {
      id: p.id,
      workspaceId: getCurrentWorkspaceId(),
      createdByMemberId,
      title: p.title,
      icon: p.icon ?? null,
      parentId: p.parentId ?? null,
      order: String(p.order),
      databaseId: p.databaseId ?? null,
      doc: p.doc,
      dbCells: p.dbCells ?? null,
      createdAt: new Date(p.createdAt).toISOString(),
      updatedAt: new Date(p.updatedAt).toISOString(),
    } as Record<string, unknown> & { id: string; updatedAt?: string },
  );
}

type DbMap = Record<string, DatabaseBundle>;

function now(): number {
  return Date.now();
}

function seedColumns(): ColumnDef[] {
  return [
    { id: newId(), name: "이름", type: "title" },
    { id: newId(), name: "텍스트", type: "text" },
  ];
}

type DatabaseStoreState = {
  version: number;
  databases: DbMap;
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
};

export type DatabaseStore = DatabaseStoreState & DatabaseStoreActions;

/** 컬럼별 기본 셀 값 — 현재는 status만 첫 옵션을 채움, 나머지는 null. */
function defaultCellValueForColumn(col: ColumnDef): CellValue {
  if (col.type === "status") {
    return col.config?.options?.[0]?.id ?? null;
  }
  return null;
}

/** 표시용 제목 정규화 — 비교·중복 검사에 공통 사용 */
export function normalizeDbTitle(title: string): string {
  return title.trim() || "제목 없음";
}

function isDatabaseTitleTaken(
  databases: DbMap,
  title: string,
  exceptId: string,
): boolean {
  const n = normalizeDbTitle(title);
  for (const [id, b] of Object.entries(databases)) {
    if (id === exceptId) continue;
    if (normalizeDbTitle(b.meta.title) === n) return true;
  }
  return false;
}

/** 신규 DB용 — 기존과 겹치지 않는 제목 */
function allocateUniqueDatabaseTitle(
  databases: DbMap,
  preferred: string,
): string {
  let base = normalizeDbTitle(preferred);
  if (base === "제목 없음") base = "새 데이터베이스";
  let candidate = base;
  let n = 2;
  while (isDatabaseTitleTaken(databases, candidate, "")) {
    candidate = `${base} (${n})`;
    n += 1;
  }
  return candidate;
}

/** 행 페이지를 직접 생성하고 id를 반환 — `databaseRowPages`에서 pageStore 와 연결. */
function createRowPage(databaseId: string, title: string): string {
  return createRowPageLinkedToDatabase(databaseId, title);
}

function toDatabaseSnapshot(bundle: DatabaseBundle): DatabaseSnapshot {
  return structuredClone(bundle);
}

function toPageSnapshot(page: ReturnType<typeof usePageStore.getState>["pages"][string]): PageSnapshot {
  return {
    id: page.id,
    title: page.title,
    icon: page.icon,
    doc: structuredClone(page.doc),
    parentId: page.parentId,
    order: page.order,
    databaseId: page.databaseId,
    dbCells: page.dbCells ? structuredClone(page.dbCells) : undefined,
  };
}

function extractFullPageDatabaseId(
  page: ReturnType<typeof usePageStore.getState>["pages"][string],
): string | null {
  const first = page.doc?.content?.[0] as
    | { type?: string; attrs?: Record<string, unknown> }
    | undefined;
  if (!first || first.type !== "databaseBlock") return null;
  const attrs = first.attrs ?? {};
  if (attrs.layout !== "fullPage") return null;
  return typeof attrs.databaseId === "string" ? attrs.databaseId : null;
}

function makeReferenceCellValue(
  cols: ColumnDef[],
  sourceDbId: string,
  sourceTitle: string,
): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  const refValue = `quicknote://database/${sourceDbId}`;
  const urlCol = cols.find((c) => c.type === "url");
  const textCol = cols.find((c) => c.type === "text");
  const fallbackCol = cols.find((c) => c.type !== "title");
  const target = urlCol ?? textCol ?? fallbackCol;
  if (!target) return out;
  out[target.id] =
    target.type === "url" ? refValue : `DB 참조: ${sourceTitle} (${sourceDbId})`;
  return out;
}

function isValidDatabaseSnapshot(
  snapshot: DatabaseSnapshot | null,
): snapshot is DatabaseSnapshot {
  if (!snapshot) return false;
  if (!Array.isArray(snapshot.columns)) return false;
  if (!Array.isArray(snapshot.rowPageOrder)) return false;
  if (!snapshot.meta || typeof snapshot.meta.id !== "string") return false;
  return true;
}

export const useDatabaseStore = create<DatabaseStore>()(
  (set, get) => ({
      version: DATABASE_STORE_VERSION,
      databases: {},

      createDatabase: (title = "새 데이터베이스") => {
        const id = newId();
        const t = now();
        const cols = seedColumns();
        const seedPageId = createRowPage(id, "항목 1");
        const uniqueTitle = allocateUniqueDatabaseTitle(get().databases, title);

        const bundle: DatabaseBundle = {
          meta: { id, title: uniqueTitle, createdAt: t, updatedAt: t },
          columns: cols,
          rowPageOrder: [seedPageId],
        };

        set((state) => ({
          databases: { ...state.databases, [id]: bundle },
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
          hs.recordDbEvent(
            id,
            "db.delete",
            toDatabaseSnapshot(bundle),
            shouldWriteAnchor(events.length + 1)
              ? toDatabaseSnapshot(bundle)
              : undefined,
          );
          enqueueAsync("softDeleteDatabase", {
            id,
            workspaceId: useWorkspaceStore.getState().currentWorkspaceId ?? "",
            updatedAt: new Date().toISOString(),
          });
        }
      },

      setDatabaseTitle: (id, title) => {
        const state = get();
        const b = state.databases[id];
        if (!b) return false;
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
        set((state) => {
          const bundle = state.databases[databaseId];
          if (!bundle) return state;
          const next = bundle.columns.map((c) => {
            if (c.id !== columnId) return c;
            // title 컬럼의 type 변경 차단
            if (c.type === "title" && patch.type && patch.type !== "title") {
              return c;
            }
            return { ...c, ...patch, id: c.id };
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

    getBundle: (databaseId) => get().databases[databaseId],
    resolveBundle: (databaseId) => get().getBundle(databaseId),
  }),
);

export function listDatabases(state: DatabaseStore): { id: string; meta: DatabaseMeta }[] {
  return Object.entries(state.databases)
    .map(([id, b]) => ({ id, meta: b.meta }))
    .sort((a, b) => b.meta.updatedAt - a.meta.updatedAt);
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
