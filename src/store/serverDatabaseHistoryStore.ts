import { create } from "zustand";
import type { DbHistoryKind, HistoryTimelineEntry } from "../types/history";
import type { GqlDatabaseHistoryEntry } from "../lib/sync/graphql/operations";
import {
  deleteDatabaseHistoryEventsApi,
  listDatabaseHistoryApi,
  restoreDatabaseVersionApi,
} from "../lib/sync/databaseHistoryApi";
import { applyRemoteDatabaseToStore } from "../lib/sync/storeApply";
import { enqueueUpsertDatabase } from "./databaseStore/helpers";
import { useDatabaseStore } from "./databaseStore";

const seededBaselineDatabases = new Set<string>();

type State = {
  byDatabaseId: Record<string, GqlDatabaseHistoryEntry[]>;
  loading: Record<string, boolean>;
  seeding: Record<string, boolean>;
  error: Record<string, string | null>;
};

type Actions = {
  fetchDatabaseHistory: (databaseId: string, workspaceId: string) => Promise<void>;
  getDatabaseTimeline: (databaseId: string) => HistoryTimelineEntry[];
  restoreDatabaseHistoryEvent: (
    databaseId: string,
    workspaceId: string,
    historyId: string,
  ) => Promise<boolean>;
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

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const useServerDatabaseHistoryStore = create<State & Actions>()((set, get) => ({
  byDatabaseId: {},
  loading: {},
  seeding: {},
  error: {},

  fetchDatabaseHistory: async (databaseId, workspaceId) => {
    if (!databaseId || !workspaceId) return;
    set((s) => ({
      loading: { ...s.loading, [databaseId]: true },
      error: { ...s.error, [databaseId]: null },
    }));
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

  restoreDatabaseHistoryEvent: async (databaseId, workspaceId, historyId) => {
    const restored = await restoreDatabaseVersionApi({ databaseId, workspaceId, historyId });
    applyRemoteDatabaseToStore(restored);
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
