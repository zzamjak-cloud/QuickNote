import { usePageContentLoadStore } from "../../store/pageContentLoadStore";
import { usePageStore } from "../../store/pageStore";
import { fetchPageById } from "./bootstrap";
import { applyRemotePageToStore } from "./storeApply";
import { refreshWorkspaceSnapshot } from "./workspaceSwitch";

const inFlightByPageId = new Map<string, Promise<boolean>>();

export async function ensurePageContentLoaded(args: {
  pageId: string;
  workspaceId?: string | null;
  source?: string;
}): Promise<boolean> {
  const pageId = args.pageId;
  const state = usePageContentLoadStore.getState();
  const page = usePageStore.getState().pages[pageId];
  if (!state.metaOnlyByPageId[pageId] && page?.contentLoaded !== false) return true;
  const existing = inFlightByPageId.get(pageId);
  if (existing) return existing;

  const workspaceId =
    args.workspaceId ??
    page?.workspaceId ??
    null;
  if (!workspaceId) {
    console.warn("[QN_PAGE_CONTENT] load-skip", {
      pageId,
      reason: "missing-workspace",
      source: args.source,
    });
    return false;
  }

  const promise = (async () => {
    usePageContentLoadStore.getState().setLoading(pageId, true);
    if (import.meta.env.DEV) {
      console.info("[QN_PAGE_CONTENT] load-start", {
        pageId,
        workspaceId,
        source: args.source,
      });
    }
    try {
      const page = await fetchPageById(workspaceId, pageId);
      if (!page) {
        console.warn("[QN_PAGE_CONTENT] load-missing", {
          pageId,
          workspaceId,
          source: args.source,
        });
        return false;
      }
      applyRemotePageToStore(page);
      refreshWorkspaceSnapshot(workspaceId);
      if (import.meta.env.DEV) {
        console.info("[QN_PAGE_CONTENT] load-applied", {
          pageId,
          workspaceId,
          source: args.source,
        });
      }
      return true;
    } catch (error) {
      console.warn("[QN_PAGE_CONTENT] load-failed", {
        pageId,
        workspaceId,
        source: args.source,
        error,
      });
      return false;
    } finally {
      usePageContentLoadStore.getState().setLoading(pageId, false);
      inFlightByPageId.delete(pageId);
    }
  })();
  inFlightByPageId.set(pageId, promise);
  return promise;
}
