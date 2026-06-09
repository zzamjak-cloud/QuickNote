import { useCallback } from "react";
import { ensurePageContentLoaded } from "../../lib/sync/pageContentLoad";
import { usePageStore } from "../../store/pageStore";
import { useUiStore } from "../../store/uiStore";
import { useWorkspaceStore } from "../../store/workspaceStore";

export type OpenPageInPeekOptions = {
  navigateInPeek?: boolean;
  source?: string;
  workspaceId?: string | null;
};

export function useOpenPageInPeek() {
  const openPeek = useUiStore((s) => s.openPeek);
  const peekNavigate = useUiStore((s) => s.peekNavigate);
  const showToast = useUiStore((s) => s.showToast);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useCallback(
    async (pageId: string, options?: OpenPageInPeekOptions) => {
      const page = usePageStore.getState().pages[pageId];
      const workspaceId =
        options?.workspaceId ??
        page?.workspaceId ??
        currentWorkspaceId;
      const loaded = await ensurePageContentLoaded({
        pageId,
        workspaceId,
        source: options?.source ?? "page-tree-open",
      });
      if (!loaded) {
        showToast("페이지를 불러오지 못했습니다.", { kind: "error" });
        return false;
      }
      if (options?.navigateInPeek) peekNavigate(pageId);
      else openPeek(pageId);
      return true;
    },
    [currentWorkspaceId, openPeek, peekNavigate, showToast],
  );
}
