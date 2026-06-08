import { useCallback, useMemo } from "react";
import { useDatabaseStore } from "../../store/databaseStore";
import { useDatabaseRowIndexStore } from "../../store/databaseRowIndexStore";
import { usePageStore } from "../../store/pageStore";
import { useUiStore } from "../../store/uiStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { ensurePageContentLoaded } from "../../lib/sync/pageContentLoad";
import { resolveDatabaseRowRemoteKey } from "../../lib/sync/externalProtectedDatabaseLoad";
import type { FilterRule } from "../../types/database";

export type OpenDatabaseRowOptions = {
  navigateInPeek?: boolean;
  source?: string;
};

export function useEnsureDatabaseRowContent(databaseId: string) {
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const rowIndexKey = useMemo(
    () => resolveDatabaseRowRemoteKey(databaseId, currentWorkspaceId),
    [currentWorkspaceId, databaseId],
  );
  const rowIndexRows = useDatabaseRowIndexStore(
    (s) => (rowIndexKey ? s.snapshotsByKey[rowIndexKey]?.rows ?? [] : []),
  );
  const rowIndexWorkspaceByPageId = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rowIndexRows) map.set(row.pageId, row.workspaceId);
    return map;
  }, [rowIndexRows]);
  return useCallback(
    async (pageId: string, options?: OpenDatabaseRowOptions) => {
      const page = usePageStore.getState().pages[pageId];
      const workspaceId =
        page?.workspaceId ??
        rowIndexWorkspaceByPageId.get(pageId) ??
        currentWorkspaceId;
      const loaded = await ensurePageContentLoaded({
        pageId,
        workspaceId,
        source: options?.source ?? "database-row-open",
      });
      return loaded;
    },
    [currentWorkspaceId, rowIndexWorkspaceByPageId],
  );
}

export function useOpenDatabaseRow(databaseId: string) {
  const ensureRowContent = useEnsureDatabaseRowContent(databaseId);
  const openPeek = useUiStore((s) => s.openPeek);
  const peekNavigate = useUiStore((s) => s.peekNavigate);
  const showToast = useUiStore((s) => s.showToast);

  return useCallback(
    async (pageId: string, options?: OpenDatabaseRowOptions) => {
      const loaded = await ensureRowContent(pageId, options);
      if (!loaded) {
        showToast("항목 페이지를 불러오지 못했습니다.", { kind: "error" });
        return;
      }
      if (options?.navigateInPeek) peekNavigate(pageId);
      else openPeek(pageId);
    },
    [ensureRowContent, openPeek, peekNavigate, showToast],
  );
}

export function useAddDatabaseRowAndOpen(databaseId: string) {
  const addRow = useDatabaseStore((s) => s.addRow);
  const openRow = useOpenDatabaseRow(databaseId);

  return useCallback(
    (seedFilters?: FilterRule[], options?: OpenDatabaseRowOptions) => {
      const pageId = addRow(databaseId, seedFilters);
      if (!pageId) return "";
      void openRow(pageId, options);
      return pageId;
    },
    [addRow, databaseId, openRow],
  );
}
