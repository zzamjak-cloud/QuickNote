import { create } from "zustand";
import type { DbHistoryKind, HistoryTimelineEntry } from "../types/history";
import type { GqlDatabaseHistoryEntry } from "../lib/sync/graphql/operations";
import {
  deleteDatabaseHistoryEventsApi,
  listDatabaseHistoryApi,
  restoreDatabaseVersionApi,
  saveDatabaseVersionApi,
} from "../lib/sync/databaseHistoryApi";
import { applyRemoteDatabaseToStore, applyRemotePageToStore } from "../lib/sync/storeApply";
import { enqueueUpsertDatabase } from "./databaseStore/helpers";
import { useDatabaseStore } from "./databaseStore";
import { usePageStore } from "./pageStore";
import { fetchPageById } from "../lib/sync/bootstrap";
import { clearLocalDeleteGuard } from "../lib/sync/localDeleteGuards";
import { formatError } from "../lib/util/formatError";

const seededBaselineDatabases = new Set<string>();

type State = {
  byDatabaseId: Record<string, GqlDatabaseHistoryEntry[]>;
  loading: Record<string, boolean>;
  seeding: Record<string, boolean>;
  error: Record<string, string | null>;
};

type Actions = {
  fetchDatabaseHistory: (databaseId: string, workspaceId: string, opts?: { silent?: boolean }) => Promise<void>;
  getDatabaseTimeline: (databaseId: string) => HistoryTimelineEntry[];
  restoreDatabaseHistoryEvent: (
    databaseId: string,
    workspaceId: string,
    historyId: string,
    restoredRowIds?: string[],
  ) => Promise<boolean>;
  /** 현재 DB 상태를 즉시 버전 체크포인트로 저장(세션 머지 우회). */
  saveDatabaseVersion: (databaseId: string, workspaceId: string) => Promise<boolean>;
  deleteDatabaseHistoryEvents: (
    databaseId: string,
    workspaceId: string,
    historyIds: string[],
  ) => Promise<void>;
};

function kindLabel(kind: string): string {
  if (kind === "database.create") return "DB 생성";
  if (kind === "database.session") return "편집 세션";
  if (kind === "database.restoreVersion") return "DB 버전 복구";
  if (kind === "database.checkpoint") return "버전 저장";
  if (kind === "database.delete") return "DB 삭제";
  if (kind === "database.update") return "DB 수정";
  return kind;
}

function toTimelineEntry(entry: GqlDatabaseHistoryEntry): HistoryTimelineEntry {
  const ts = Date.parse(entry.createdAt) || Date.now();
  // 세션 엔트리는 createdAt=세션 시작, lastActivityAt=마지막 편집 — 표시 시각은 마지막 활동 기준.
  const endTs = (entry.lastActivityAt && Date.parse(entry.lastActivityAt)) || ts;
  return {
    id: entry.historyId,
    bucket:
      entry.kind === "database.update" || entry.kind === "database.session"
        ? "structure"
        : "content",
    representativeKind: entry.kind as DbHistoryKind,
    eventIds: [entry.historyId],
    startTs: ts,
    endTs,
    count: 1,
    label: kindLabel(entry.kind),
    lastEditedByMemberId: entry.createdByMemberId ?? undefined,
    lastEditedByName: entry.createdByName ?? undefined,
  };
}

export const useServerDatabaseHistoryStore = create<State & Actions>()((set, get) => ({
  byDatabaseId: {},
  loading: {},
  seeding: {},
  error: {},

  fetchDatabaseHistory: async (databaseId, workspaceId, opts) => {
    if (!databaseId || !workspaceId) return;
    // silent: 백그라운드 재조회(행 변경 반영)에서는 loading 토글을 생략해 프리뷰가 깜빡이지 않게 한다.
    if (!opts?.silent) {
      set((s) => ({
        loading: { ...s.loading, [databaseId]: true },
        error: { ...s.error, [databaseId]: null },
      }));
    }
    try {
      const rows = await listDatabaseHistoryApi(databaseId, workspaceId, 100);
      const shouldSeedBaseline = rows.length === 0 && !seededBaselineDatabases.has(databaseId);
      set((s) => ({
        byDatabaseId: { ...s.byDatabaseId, [databaseId]: rows },
        loading: { ...s.loading, [databaseId]: false },
        seeding: { ...s.seeding, [databaseId]: shouldSeedBaseline },
      }));
      if (shouldSeedBaseline) {
        seededBaselineDatabases.add(databaseId);
        const bundle = useDatabaseStore.getState().databases[databaseId];
        if (bundle) {
          enqueueUpsertDatabase({
            ...bundle,
            meta: { ...bundle.meta, updatedAt: Date.now() },
          });
          setTimeout(() => {
            void get().fetchDatabaseHistory(databaseId, workspaceId);
          }, 1800);
        } else {
          set((s) => ({
            seeding: { ...s.seeding, [databaseId]: false },
          }));
        }
      }
    } catch (err) {
      set((s) => ({
        loading: { ...s.loading, [databaseId]: false },
        seeding: { ...s.seeding, [databaseId]: false },
        error: { ...s.error, [databaseId]: formatError(err) },
      }));
    }
  },

  getDatabaseTimeline: (databaseId) =>
    (get().byDatabaseId[databaseId] ?? []).map(toTimelineEntry),

  restoreDatabaseHistoryEvent: async (databaseId, workspaceId, historyId, restoredRowIds) => {
    const restored = await restoreDatabaseVersionApi({ databaseId, workspaceId, historyId });
    applyRemoteDatabaseToStore(restored);
    // 복원 버전 rowPageOrder 의 행 중 현재 로컬에 살아있지 않은(삭제됐거나 없는) 페이지는
    // 서버에서 un-delete 된 본문을 끌어와 store 에 반영한다(additive 복구). 실패는 무시.
    if (restoredRowIds && restoredRowIds.length > 0) {
      // 로컬 store 는 삭제된 페이지를 map 에서 제거한다(soft-delete 필드 없음).
      // 따라서 "살아있지 않음" = map 에 없음.
      const livePages = usePageStore.getState().pages;
      const idsToFetch = restoredRowIds.filter((id) => !livePages[id]);
      await Promise.all(
        idsToFetch.map(async (id) => {
          try {
            clearLocalDeleteGuard("page", id, workspaceId);
            const page = await fetchPageById(workspaceId, id);
            if (page) applyRemotePageToStore(page);
          } catch {
            // 개별 페이지 복구 실패는 무시(상한 없음, 행 수 ~수십).
          }
        }),
      );
    }
    await get().fetchDatabaseHistory(databaseId, workspaceId);
    return true;
  },

  saveDatabaseVersion: async (databaseId, workspaceId) => {
    if (!databaseId || !workspaceId) return false;
    await saveDatabaseVersionApi(databaseId, workspaceId);
    await get().fetchDatabaseHistory(databaseId, workspaceId);
    return true;
  },

  deleteDatabaseHistoryEvents: async (databaseId, workspaceId, historyIds) => {
    if (historyIds.length === 0) return;
    await deleteDatabaseHistoryEventsApi(databaseId, workspaceId, historyIds);
    set((s) => {
      const existing = s.byDatabaseId[databaseId] ?? [];
      const idSet = new Set(historyIds);
      return {
        byDatabaseId: {
          ...s.byDatabaseId,
          [databaseId]: existing.filter((entry) => !idSet.has(entry.historyId)),
        },
      };
    });
  },
}));
