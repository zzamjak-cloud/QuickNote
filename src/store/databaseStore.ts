import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { zustandStorage } from "../lib/storage/index";
import type {
  CellValue,
  ColumnDef,
  ColumnType,
  DatabaseBundle,
  DatabaseMeta,
} from "../types/database";
import { DATABASE_STORE_VERSION } from "../types/database";
import { newId } from "../lib/id";
import { reportNonFatal } from "../lib/reportNonFatal";
import { createRowPageLinkedToDatabase } from "../lib/services/databaseRowPages";
import { usePageStore } from "./pageStore";

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

export const useDatabaseStore = create<DatabaseStore>()(
  persist(
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
              }
              return { pages: nextPages };
            });
          }
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
      },

      removeColumn: (databaseId, columnId) => {
        const bundleBefore = get().databases[databaseId];
        if (!bundleBefore) return;
        const target = bundleBefore.columns.find((c) => c.id === columnId);
        if (!target || target.type === "title") return;
        const nextCols = bundleBefore.columns.filter((c) => c.id !== columnId);

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
        return pageId;
      },

      deleteRow: (databaseId, pageId) => {
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
      },

      getBundle: (databaseId) => get().databases[databaseId],
      resolveBundle: (databaseId) => get().getBundle(databaseId),
    }),
    {
      name: "quicknote.databaseStore.v2",
      storage: createJSONStorage(() => zustandStorage),
      version: DATABASE_STORE_VERSION,
      // v1 → v2: 행 데이터 모델 전면 변경. 기존 데이터를 안전하게 마이그레이션할 수 없어 wipe.
      migrate: (persistedState, fromVersion) => {
        try {
          const key = `quicknote.databaseStore.migrateBackup.${Date.now()}`;
          localStorage.setItem(
            key,
            JSON.stringify({
              fromVersion,
              savedAt: Date.now(),
              payload: persistedState,
            }),
          );
          localStorage.setItem(
            "quicknote.databaseStore.lastMigrateBackupKey",
            key,
          );
        } catch (err) {
          reportNonFatal(err, "databaseStore.migrate.backup");
        }
        return { version: DATABASE_STORE_VERSION, databases: {} };
      },
    },
  ),
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
