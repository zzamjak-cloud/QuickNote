import { create } from "zustand";
import type { GqlDatabase } from "../lib/sync/graphql/operations";
import {
  fetchTrashedDatabasesBatch,
  restoreDatabaseRemote,
} from "../lib/sync/trashApi";
import { applyRemoteDatabaseToStore } from "../lib/sync/storeApply";

// 삭제된 DB(휴지통) 목록·복원 — 서버 권위(listTrashedDatabases / restoreDatabase).
// 기존 로컬 historyStore.getDeletedDbRestorePoints 를 대체한다.

type State = {
  byWorkspaceId: Record<string, GqlDatabase[]>;
  nextTokenByWorkspaceId: Record<string, string | null>;
  loading: Record<string, boolean>;
  error: Record<string, string | null>;
};

type Actions = {
  fetchTrashedDatabases: (workspaceId: string) => Promise<void>;
  loadMoreTrashedDatabases: (workspaceId: string) => Promise<void>;
  restoreTrashedDatabase: (id: string, workspaceId: string) => Promise<boolean>;
  getTrashedDatabases: (workspaceId: string) => GqlDatabase[];
  hasMore: (workspaceId: string) => boolean;
};

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const useServerTrashedDatabaseStore = create<State & Actions>()((set, get) => ({
  byWorkspaceId: {},
  nextTokenByWorkspaceId: {},
  loading: {},
  error: {},

  fetchTrashedDatabases: async (workspaceId) => {
    if (!workspaceId) return;
    if (get().loading[workspaceId]) return;
    set((s) => ({
      loading: { ...s.loading, [workspaceId]: true },
      error: { ...s.error, [workspaceId]: null },
    }));
    try {
      const { items, nextToken } = await fetchTrashedDatabasesBatch(workspaceId);
      set((s) => ({
        byWorkspaceId: { ...s.byWorkspaceId, [workspaceId]: items },
        nextTokenByWorkspaceId: { ...s.nextTokenByWorkspaceId, [workspaceId]: nextToken },
        loading: { ...s.loading, [workspaceId]: false },
      }));
    } catch (err) {
      set((s) => ({
        loading: { ...s.loading, [workspaceId]: false },
        error: { ...s.error, [workspaceId]: formatError(err) },
      }));
    }
  },

  loadMoreTrashedDatabases: async (workspaceId) => {
    const token = get().nextTokenByWorkspaceId[workspaceId];
    if (!token || get().loading[workspaceId]) return;
    set((s) => ({ loading: { ...s.loading, [workspaceId]: true } }));
    try {
      const { items, nextToken } = await fetchTrashedDatabasesBatch(workspaceId, token);
      set((s) => ({
        byWorkspaceId: {
          ...s.byWorkspaceId,
          [workspaceId]: [...(s.byWorkspaceId[workspaceId] ?? []), ...items],
        },
        nextTokenByWorkspaceId: { ...s.nextTokenByWorkspaceId, [workspaceId]: nextToken },
        loading: { ...s.loading, [workspaceId]: false },
      }));
    } catch (err) {
      set((s) => ({
        loading: { ...s.loading, [workspaceId]: false },
        error: { ...s.error, [workspaceId]: formatError(err) },
      }));
    }
  },

  restoreTrashedDatabase: async (id, workspaceId) => {
    if (!id || !workspaceId) return false;
    const restored = await restoreDatabaseRemote(id, workspaceId);
    applyRemoteDatabaseToStore(restored);
    // 복원된 항목을 목록에서 제거
    set((s) => ({
      byWorkspaceId: {
        ...s.byWorkspaceId,
        [workspaceId]: (s.byWorkspaceId[workspaceId] ?? []).filter((d) => d.id !== id),
      },
    }));
    return true;
  },

  getTrashedDatabases: (workspaceId) => get().byWorkspaceId[workspaceId] ?? [],
  hasMore: (workspaceId) => Boolean(get().nextTokenByWorkspaceId[workspaceId]),
}));
