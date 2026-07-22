import { create } from "zustand";
import { persist } from "zustand/middleware";
import { deferredDatabaseStorage } from "../lib/storage/index";
import type {
  CellValue,
  ColumnDef,
  ColumnType,
  DatabaseBundle,
  DatabaseMeta,
  DatabasePanelState,
  DatabaseRowPreset,
  DatabaseTemplate,
  FilterRule,
} from "../types/database";
import { DATABASE_STORE_VERSION, emptyPanelState } from "../types/database";
import { newId } from "../lib/id";
import { usePageStore } from "./pageStore";
import { recordDbMutation } from "./historyStore";
import { enqueueAsync } from "../lib/sync/runtime";
import { markLocallyDeletedEntity } from "../lib/sync/localDeleteGuards";
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
  LC_MILESTONE_DATABASE_TITLE,
  LC_FEATURE_DATABASE_TITLE,
  isLCSchedulerDatabaseId,
  isLCMilestoneDatabaseId,
  isLCFeatureDatabaseId,
  isProtectedDatabaseId,
} from "../lib/scheduler/database";
import {
  allocateUniqueDatabaseTitle,
  createRowPage,
  defaultCellValueForColumn,
  enqueueUpsertDatabase,
  enqueueUpsertPageRaw,
  getCurrentWorkspaceId,
  isDatabaseTitleTaken,
  normalizeDbTitle,
  seedColumns,
  toDatabaseSnapshot,
} from "./databaseStore/helpers";
import { createColumnActions } from "./databaseStore/actions/columnActions";
import { createRowActions } from "./databaseStore/actions/rowActions";
import { getDbCollab } from "../lib/collab/dbCollabRegistry";
import { readDbStructure } from "../lib/collab/dbBundleYjs";
import { writeCellsToCollabDoc } from "../lib/collab/dbCellsCollab";
import type { Page } from "../types/page";
import {
  registerTemplatePageMarkerReconcileHandler,
  registerTemplatePageTitleChangeHandler,
} from "../lib/database/templatePageTitleSync";

export { migrateDatabaseStore } from "./databaseStore/migrations";
export { normalizeDbTitle } from "./databaseStore/helpers";

function now(): number {
  return Date.now();
}

/** 본문이 비었는지(없거나 단일 빈 문단) 판별 — 템플릿 본문 복사 여부 결정에 쓴다. */
function templateDocHasContent(doc: unknown): boolean {
  if (!doc || typeof doc !== "object") return false;
  const d = doc as {
    type?: string;
    content?: Array<{ type?: string; content?: unknown[] }>;
  };
  if (d.type !== "doc" || !Array.isArray(d.content) || d.content.length === 0) {
    return false;
  }
  if (d.content.length === 1) {
    const only = d.content[0];
    if (
      only?.type === "paragraph" &&
      (!Array.isArray(only.content) || only.content.length === 0)
    ) {
      return false;
    }
  }
  return true;
}

function isLiveFullTemplateMarkerPage(page: Page): boolean {
  // Page 스토어는 tombstone을 보관하지 않고 원격 deletedAt 수신 즉시 엔트리를 제거한다.
  // 구버전 persist에 삭제 필드가 섞였을 가능성도 방어하면서 full-content가 확인된 페이지만 복원한다.
  const deletedAt = (page as Page & { deletedAt?: unknown }).deletedAt;
  return (
    deletedAt == null &&
    page.contentLoaded === true &&
    page.dbCells?.["_qn_isTemplate"] === "1"
  );
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
  /** 원본 DB 화면의 필터 프리셋 탭·뷰 설정을 DB 동기화 payload에 반영한다. */
  patchDatabasePanelState: (databaseId: string, patch: Partial<DatabasePanelState>) => void;
  addColumn: (databaseId: string, col: Omit<ColumnDef, "id"> & { id?: string }) => string;
  updateColumn: (
    databaseId: string,
    columnId: string,
    patch: Partial<Pick<ColumnDef, "name" | "type" | "config" | "width" | "icon">>,
  ) => void;
  removeColumn: (databaseId: string, columnId: string) => void;
  moveColumn: (databaseId: string, fromIdx: number, toIdx: number) => void;
  /** 시드/추가 행을 위한 행 페이지 생성 — 새 페이지 id 반환 */
  addRow: (databaseId: string, seedFilters?: FilterRule[]) => string;
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
  /** pageLink 셀 갱신 — 같은 이름의 pageLink 컬럼 기준으로 양방향 연결 처리 */
  updatePageLinkCell: (
    databaseId: string,
    rowPageId: string,
    columnId: string,
    nextPageIds: string[],
  ) => void;
  setRowOrder: (databaseId: string, orderedPageIds: string[]) => void;
  attachPageAsRow: (databaseId: string, pageId: string) => boolean;
  detachRowToNormalPage: (pageId: string) => boolean;
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
  /** 협업 Y.Doc materialize → store 구조 반영(meta·행 보존) + baseline 갱신 + 서버 영속. */
  applyCollabDbStructure: (
    databaseId: string,
    structure: import("../lib/collab/dbBundleYjs").DbStructure,
  ) => void;
  /** 서버 시드 누락/캡 대비: Y rows 가 비어 있을 때만 로컬 행 셀로 보충(map-keyed → 동시 시드 수렴). */
  seedCollabRowsFromStore: (databaseId: string) => void;
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
        const uniqueTitle = allocateUniqueDatabaseTitle(get().databases, title, workspaceId);

        const bundle: DatabaseBundle = {
          meta: { id, workspaceId: workspaceId || undefined, title: uniqueTitle, createdAt: t, updatedAt: t },
          columns: cols,
          rowPageOrder: [seedPageId],
        };

        set((state) => ({
          databases: { ...state.databases, [id]: bundle },
          cacheWorkspaceId: workspaceId || state.cacheWorkspaceId,
        }));
        recordDbMutation(
          id,
          "db.create",
          toDatabaseSnapshot(bundle),
          () => toDatabaseSnapshot(bundle),
        );
        enqueueUpsertDatabase(bundle);
        return id;
      },

      deleteDatabase: (id) => {
        // 보호 DB(작업·마일스톤·피처) 는 삭제 금지
        if (isProtectedDatabaseId(id)) return;
        const bundle = get().databases[id];
        const homePageId = usePageStore.getState().findFullPagePageIdForDatabase(id);
        if (bundle) {
          for (const pageId of bundle.rowPageOrder) {
            usePageStore.getState().deletePage(pageId);
          }
        }
        if (homePageId) {
          usePageStore.getState().deletePage(homePageId);
        }
        set((state) => {
          if (!(id in state.databases)) return state;
          const next = { ...state.databases };
          delete next[id];
          return { databases: next };
        });
        if (bundle) {
          const workspaceId = bundle.meta.workspaceId ?? useWorkspaceStore.getState().currentWorkspaceId ?? "";
          const updatedAt = new Date().toISOString();
          recordDbMutation(
            id,
            "db.delete",
            toDatabaseSnapshot(bundle),
            () => toDatabaseSnapshot(bundle),
          );
          markLocallyDeletedEntity("database", id, workspaceId, Date.parse(updatedAt) || Date.now());
          enqueueAsync("softDeleteDatabase", {
            id,
            workspaceId,
            updatedAt,
          });
        }
      },

      applyCollabDbStructure: (databaseId, structure) => {
        const before = get().databases[databaseId];
        if (!before) return;
        // 미시드(빈) Y.Doc 구조로 기존 DB 를 덮어쓰면 컬럼·행이 통째로 사라진다(데이터 유실).
        // 컬럼은 항상 최소 title 1개라 columns 가 비면 = Y.Doc 미시드/sync 전 → 기존 구조가 있으면 materialize 생략.
        if ((structure.columns?.length ?? 0) === 0 && before.columns.length > 0) return;
        // slice C: 멤버십(rowMembers)·순서(rowPageOrder LWW)로 표시 순서 계산.
        // finalOrder = 순서∩멤버 ++ (멤버 중 순서에 없는 것 append). 멤버 비면 구버전 폴백.
        const members = structure.rowMembers ?? [];
        const memberSet = new Set(members);
        const order = structure.rowPageOrder ?? [];
        let finalOrder: string[];
        if (memberSet.size === 0) {
          // 부분 시드(컬럼만 있고 멤버·순서 모두 빈) Y 구조가 기존 행 순서를 비우지 못하게 보존한다.
          finalOrder =
            order.length === 0 && before.rowPageOrder.length > 0
              ? before.rowPageOrder
              : order;
        } else {
          const inOrder = order.filter((id) => memberSet.has(id));
          const seen = new Set(inOrder);
          finalOrder = [...inOrder, ...members.filter((id) => !seen.has(id))];
        }
        const nextBundle: DatabaseBundle = {
          ...before,
          columns: structure.columns as ColumnDef[],
          presets: structure.presets as DatabaseRowPreset[],
          // 부분 panelState(서버/collab DbStructure 가 searchQuery 등 일부 키를 빠뜨릴 수 있음)를
          // 그대로 저장하면 소비 측이 panelState.searchQuery.trim() 에서 크래시한다.
          // emptyPanelState 기본값으로 항상 완전한 형태를 보장(patchDatabasePanelState 와 동일 패턴).
          panelState: {
            ...emptyPanelState(),
            ...((structure.panelState ?? {}) as Partial<DatabasePanelState>),
          },
          rowPageOrder: finalOrder,
          meta: { ...before.meta, updatedAt: now() },
        };
        set((state) => ({ databases: { ...state.databases, [databaseId]: nextBundle } }));
        const handle = getDbCollab(databaseId);
        if (handle) handle.baseline = structure; // 다음 reconcile 삭제 판정 기준 갱신
        // 서버 영속(LWW 파생본). skipCollab 으로 reconcile 가로채기를 우회 → 루프 없음.
        // templates는 Y.Doc 구조에 없으므로 materialize 업서트가 같은 dedupe key의
        // 템플릿 payload를 덮지 않도록 현재 목록을 항상 함께 싣는다.
        enqueueUpsertDatabase(nextBundle, get().dbTemplates[databaseId], {
          skipCollab: true,
        });
        // slice B: Y rows → 각 행 dbCells materialize. slice C: 멤버 행에만 적용(비멤버=삭제됨).
        const rows = structure.rows ?? {};
        const changed: Page[] = [];
        usePageStore.setState((s) => {
          let dirty = false;
          const nextPages = { ...s.pages };
          for (const [rowPageId, cells] of Object.entries(rows)) {
            if (memberSet.size > 0 && !memberSet.has(rowPageId)) continue; // 비멤버 제외(삭제 승)
            const page = nextPages[rowPageId];
            if (!page) continue;
            if (JSON.stringify(page.dbCells ?? {}) === JSON.stringify(cells)) continue;
            const updated = { ...page, dbCells: cells as Record<string, CellValue>, updatedAt: now() };
            nextPages[rowPageId] = updated;
            changed.push(updated);
            dirty = true;
          }
          return dirty ? { pages: nextPages } : s;
        });
        for (const p of changed) enqueueUpsertPageRaw(p, { includeCells: true });
      },

      // 서버 시드 누락/캡 대비: Y rows 가 비어 있을 때만 로컬 행 셀로 보충.
      // rows 는 map-keyed 라 동시 시드도 LWW 수렴(중복 없음).
      seedCollabRowsFromStore: (databaseId) => {
        const handle = getDbCollab(databaseId);
        if (!handle) return;
        const existingRows = readDbStructure(handle.doc).rows;
        if (Object.keys(existingRows).length > 0) return; // 서버 시드 우선
        const bundle = get().databases[databaseId];
        if (!bundle) return;
        const pages = usePageStore.getState().pages;
        for (const rowPageId of bundle.rowPageOrder) {
          const cells = pages[rowPageId]?.dbCells;
          if (cells && Object.keys(cells).length > 0) {
            writeCellsToCollabDoc(databaseId, rowPageId, cells);
          }
        }
      },

      setDatabaseTitle: (id, title) => {
        const state = get();
        const b = state.databases[id];
        if (!b) return false;
        if (isLCSchedulerDatabaseId(id)) {
          return normalizeDbTitle(title) === LC_SCHEDULER_DATABASE_TITLE;
        }
        if (isLCMilestoneDatabaseId(id)) {
          return normalizeDbTitle(title) === LC_MILESTONE_DATABASE_TITLE;
        }
        if (isLCFeatureDatabaseId(id)) {
          return normalizeDbTitle(title) === LC_FEATURE_DATABASE_TITLE;
        }
        const nextTitle = normalizeDbTitle(title);
        if (isDatabaseTitleTaken(state.databases, nextTitle, id, b.meta.workspaceId)) {
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
          recordDbMutation(
            id,
            "db.title",
            { meta: structuredClone(bundleAfter.meta) },
            () => toDatabaseSnapshot(bundleAfter),
          );
          enqueueUpsertDatabase(bundleAfter);
        }
        // DB 제목 변경 시 해당 DB를 가리키는 buttonBlock 레이블 동기화
        const homePageId = usePageStore.getState().findFullPagePageIdForDatabase(id);
        if (homePageId) {
          usePageStore.getState().renamePage(homePageId, nextTitle);
          usePageStore.getState().updateButtonBlockLabels(homePageId, nextTitle);
        }
        return true;
      },

      patchDatabasePanelState: (databaseId, patch) => {
        const state = get();
        const b = state.databases[databaseId];
        if (!b) return;
        const nextPanelState: DatabasePanelState = {
          ...emptyPanelState(),
          ...(b.panelState ?? {}),
          ...patch,
        };
        set({
          databases: {
            ...state.databases,
            [databaseId]: {
              ...b,
              panelState: nextPanelState,
              meta: { ...b.meta, updatedAt: now() },
            },
          },
        });
        const bundleAfter = get().databases[databaseId];
        if (bundleAfter) enqueueUpsertDatabase(bundleAfter);
      },

      ...createColumnActions(set, get),

      ...createRowActions(set, get),

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
          recordDbMutation(
            databaseId,
            "db.preset",
            { presets: structuredClone(bundleAfter.presets ?? []) },
            () => toDatabaseSnapshot(bundleAfter),
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
          recordDbMutation(
            databaseId,
            "db.preset",
            { presets: structuredClone(bundleAfter.presets ?? []) },
            () => toDatabaseSnapshot(bundleAfter),
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
          recordDbMutation(
            databaseId,
            "db.preset",
            { presets: structuredClone(bundleAfter.presets ?? []) },
            () => toDatabaseSnapshot(bundleAfter),
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
        // 최초 page.create 업서트부터 템플릿 마커가 포함되도록 원자적으로 생성한다.
        // 생성 후 패치하면 createPage가 캡처한 마커 없는 스냅샷이 뒤늦게 전송될 수 있다.
        const pageId = createRowPage(databaseId, "새 템플릿", {
          _qn_isTemplate: "1",
        });
        const t = Date.now();
        const page = usePageStore.getState().pages[pageId];
        if (page) enqueueUpsertPageRaw(page, { includeCells: true });
        const tmpl: DatabaseTemplate = { id, title: "새 템플릿", cells: {}, pageId };
        set((state) => {
          const bundle = state.databases[databaseId];
          const templates = [...(state.dbTemplates[databaseId] ?? []), tmpl];
          return {
            databases: bundle
              ? {
                  ...state.databases,
                  [databaseId]: {
                    ...bundle,
                    meta: { ...bundle.meta, templatesUpdatedAt: t },
                  },
                }
              : state.databases,
            dbTemplates: {
              ...state.dbTemplates,
              [databaseId]: templates,
            },
          };
        });
        const bundleAfter = get().databases[databaseId];
        const templatesAfter = get().dbTemplates[databaseId] ?? [];
        if (bundleAfter) enqueueUpsertDatabase(bundleAfter, templatesAfter);
        return pageId;
      },

      updateTemplate: (databaseId, templateId, patch) => {
        const t = Date.now();
        set((state) => {
          const list = state.dbTemplates[databaseId] ?? [];
          const bundle = state.databases[databaseId];
          return {
            databases: bundle
              ? {
                  ...state.databases,
                  [databaseId]: {
                    ...bundle,
                    meta: { ...bundle.meta, templatesUpdatedAt: t },
                  },
                }
              : state.databases,
            dbTemplates: {
              ...state.dbTemplates,
              [databaseId]: list.map((template) =>
                template.id === templateId ? { ...template, ...patch } : template,
              ),
            },
          };
        });
        const bundleAfter = get().databases[databaseId];
        const templatesAfter = get().dbTemplates[databaseId] ?? [];
        if (bundleAfter) enqueueUpsertDatabase(bundleAfter, templatesAfter);
      },

      deleteTemplate: (databaseId, templateId) => {
        const tmpl = (get().dbTemplates[databaseId] ?? []).find((t) => t.id === templateId);
        // 연결된 템플릿 페이지도 함께 삭제.
        if (tmpl?.pageId) {
          usePageStore.getState().deletePage(tmpl.pageId);
        }
        const t = Date.now();
        set((state) => {
          const list = state.dbTemplates[databaseId] ?? [];
          const bundle = state.databases[databaseId];
          return {
            databases: bundle
              ? {
                  ...state.databases,
                  [databaseId]: {
                    ...bundle,
                    meta: { ...bundle.meta, templatesUpdatedAt: t },
                  },
                }
              : state.databases,
            dbTemplates: {
              ...state.dbTemplates,
              [databaseId]: list.filter((template) => template.id !== templateId),
            },
          };
        });
        const bundleAfter = get().databases[databaseId];
        const templatesAfter = get().dbTemplates[databaseId] ?? [];
        if (bundleAfter) enqueueUpsertDatabase(bundleAfter, templatesAfter);
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
      // 기본값 컬럼 + 템플릿 셀 값 병합 주입.
      const defaults: Record<string, CellValue> = {};
      for (const col of bundle.columns) {
        const def = defaultCellValueForColumn(col);
        if (def != null) defaults[col.id] = def;
      }
      const cells = { ...defaults, ...templateCells };
      // createPage가 다음 틱에 캡처한 최초 스냅샷부터 속성을 포함하도록 초기 셀을 함께 넘긴다.
      const pageId = createRowPage(databaseId, uniqueTitle, cells);
      // 템플릿 페이지 본문(doc)도 새 행에 복제한다. 셀만 복사하고 본문을 빠뜨리면
      // 템플릿으로 만든 페이지가 빈 본문으로 생성된다(서버 자동화 경로는 본문 복사함).
      const templateDoc = templateDocHasContent(templatePage?.doc)
        ? structuredClone(templatePage!.doc)
        : null;
      if (Object.keys(cells).length > 0 || templateDoc) {
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
                ...(templateDoc ? { doc: templateDoc } : {}),
                updatedAt: t,
              },
            },
          };
        });
      }
      // 템플릿으로 만든 신규 행의 셀도 일반 addRow와 동일하게 협업 Y.Doc에 즉시 시드한다.
      // 빈 cells라도 행 inner map을 만들어 이후 동시 편집의 병합 기준을 보장한다.
      writeCellsToCollabDoc(databaseId, pageId, cells);
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
      // createPage가 예약한 초기 스냅샷 upsert보다 반드시 나중에 최종 doc·dbCells를 enqueue한다.
      // 같은 page dedupe key에서 빈 초기 payload가 최종 payload를 다시 덮는 순서 역전을 막는다.
      queueMicrotask(() => {
        const newPage = usePageStore.getState().pages[pageId];
        if (newPage) enqueueUpsertPageRaw(newPage, { includeCells: true });
      });
      return pageId;
    },

    getBundle: (databaseId) => get().databases[databaseId],
    resolveBundle: (databaseId) => get().getBundle(databaseId),
    }),
    {
      name: "quicknote.databases.v1",
      storage: deferredDatabaseStorage,
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

registerTemplatePageTitleChangeHandler((databaseId, pageId, title) => {
  const state = useDatabaseStore.getState();
  const template = (state.dbTemplates[databaseId] ?? []).find(
    (candidate) => candidate.pageId === pageId,
  );
  if (!template || template.title === title) return;
  state.updateTemplate(databaseId, template.id, { title });
});

registerTemplatePageMarkerReconcileHandler((databaseId) => {
  const state = useDatabaseStore.getState();
  const bundle = state.databases[databaseId];
  if (!bundle) return;

  const existingTemplates = state.dbTemplates[databaseId] ?? [];
  const registeredPageIds = new Set(
    existingTemplates
      .map((template) => template.pageId)
      .filter((pageId): pageId is string => Boolean(pageId)),
  );
  const orphanPages = Object.values(usePageStore.getState().pages)
    .filter(
      (page) =>
        page.databaseId === databaseId &&
        isLiveFullTemplateMarkerPage(page) &&
        !registeredPageIds.has(page.id) &&
        (!page.workspaceId ||
          !bundle.meta.workspaceId ||
          page.workspaceId === bundle.meta.workspaceId),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  if (orphanPages.length === 0) return;

  const templatesUpdatedAt = Math.max(
    Date.now(),
    (bundle.meta.templatesUpdatedAt ?? 0) + 1,
  );
  const recoveredTemplates: DatabaseTemplate[] = orphanPages.map((page) => ({
    id: `recovered-template:${page.id}`,
    title: page.title,
    // 실제 적용 경로는 연결된 template page의 dbCells를 우선하므로 registry fallback은 비워 둔다.
    cells: {},
    pageId: page.id,
  }));
  const nextTemplates = [...existingTemplates, ...recoveredTemplates];
  const recoveredPageIds = new Set(orphanPages.map((page) => page.id));
  const nextBundle: DatabaseBundle = {
    ...bundle,
    meta: { ...bundle.meta, templatesUpdatedAt },
    rowPageOrder: bundle.rowPageOrder.filter((pageId) => !recoveredPageIds.has(pageId)),
  };

  useDatabaseStore.setState((current) => ({
    ...current,
    databases: { ...current.databases, [databaseId]: nextBundle },
    dbTemplates: { ...current.dbTemplates, [databaseId]: nextTemplates },
  }));
  enqueueUpsertDatabase(nextBundle, nextTemplates);
});

export function listDatabases(state: DatabaseStore): { id: string; meta: DatabaseMeta }[] {
  const currentWorkspaceId = useWorkspaceStore.getState().currentWorkspaceId;
  return Object.entries(state.databases)
    .filter(([id, bundle]) => {
      // 보호 DB(작업·마일스톤·피처) 는 모든 워크스페이스에서 공유 — 인라인 DB 블록 연결용으로 항상 노출
      if (isProtectedDatabaseId(id)) return true;
      const workspaceId = bundle.meta.workspaceId;
      return !currentWorkspaceId || !workspaceId || workspaceId === currentWorkspaceId;
    })
    .map(([id, b]) => ({ id, meta: b.meta }))
    .sort((a, b) => {
      // 정렬 순서: 작업 → 마일스톤 → 피처 → 일반(updatedAt desc)
      const aProtected = isProtectedDatabaseId(a.id);
      const bProtected = isProtectedDatabaseId(b.id);
      if (aProtected !== bProtected) return aProtected ? -1 : 1;
      if (aProtected && bProtected) {
        const order = (id: string) =>
          isLCSchedulerDatabaseId(id) ? 0 : isLCMilestoneDatabaseId(id) ? 1 : 2;
        return order(a.id) - order(b.id);
      }
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

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__QN_templateSyncDebug = async () => {
    const state = useDatabaseStore.getState();
    const outboxSnapshotFn = (window as unknown as Record<string, unknown>).__QN_outboxSnapshot;
    const outboxSnapshot =
      typeof outboxSnapshotFn === "function"
        ? await (outboxSnapshotFn as () => Promise<unknown>)()
        : null;
    return {
      cacheWorkspaceId: state.cacheWorkspaceId,
      templatesByDatabase: Object.fromEntries(
        Object.entries(state.dbTemplates).map(([databaseId, templates]) => [
          databaseId,
          templates.map((template) => ({
            id: template.id,
            title: template.title,
            pageId: template.pageId ?? null,
          })),
        ]),
      ),
      databaseUpdatedAt: Object.fromEntries(
        Object.entries(state.databases).map(([databaseId, bundle]) => [
          databaseId,
          bundle.meta.updatedAt,
        ]),
      ),
      outboxSnapshot,
    };
  };
}
