import { usePageContentLoadStore } from "../../store/pageContentLoadStore";
import { usePageStore } from "../../store/pageStore";
import { fetchPageById } from "./bootstrap";
import { applyRemotePageToStore } from "./storeApply";
import { refreshWorkspaceSnapshot, workspaceHasStructureCache } from "./workspaceSwitch";

const inFlightByPageId = new Map<string, Promise<boolean>>();

type PageContentProbeDoc = {
  type?: string;
  content?: Array<{
    type?: string;
    content?: unknown[];
    text?: string;
  }>;
} | null | undefined;

type PageContentProbe = {
  contentLoaded?: boolean;
  doc?: PageContentProbeDoc;
} | null | undefined;

function isLikelyEmptyPlaceholderDoc(doc: PageContentProbeDoc): boolean {
  if (!doc || doc.type !== "doc") return true;
  const content = Array.isArray(doc.content) ? doc.content : [];
  if (content.length === 0) return true;
  if (content.length !== 1) return false;
  const first = content[0];
  if (first?.type !== "paragraph") return false;
  if (typeof first.text === "string" && first.text.length > 0) return false;
  return !Array.isArray(first.content) || first.content.length === 0;
}

export function shouldLoadPageContent(
  page: PageContentProbe,
  metaOnly: boolean,
): boolean {
  if (metaOnly) return true;
  if (!page) return false;
  if (page.contentLoaded === false) return true;
  if (page.contentLoaded === true) return false;
  return isLikelyEmptyPlaceholderDoc(page.doc);
}

export async function ensurePageContentLoaded(args: {
  pageId: string;
  workspaceId?: string | null;
  source?: string;
}): Promise<boolean> {
  const pageId = args.pageId;
  const state = usePageContentLoadStore.getState();
  const page = usePageStore.getState().pages[pageId];
  const existing = inFlightByPageId.get(pageId);
  if (existing) return existing;

  const workspaceId =
    args.workspaceId ??
    page?.workspaceId ??
    null;
  if (
    !shouldLoadPageContent(page, Boolean(state.metaOnlyByPageId[pageId])) &&
    !(workspaceId && !page)
  ) {
    return true;
  }
  if (!workspaceId) {
    return false;
  }

  const promise = (async () => {
    usePageContentLoadStore.getState().setLoading(pageId, true);
    try {
      const page = await fetchPageById(workspaceId, pageId);
      if (!page) {
        return false;
      }
      applyRemotePageToStore(page);
      if (workspaceHasStructureCache(workspaceId)) {
        refreshWorkspaceSnapshot(workspaceId);
      }
      return true;
    } catch {
      return false;
    } finally {
      usePageContentLoadStore.getState().setLoading(pageId, false);
      inFlightByPageId.delete(pageId);
    }
  })();
  inFlightByPageId.set(pageId, promise);
  return promise;
}
