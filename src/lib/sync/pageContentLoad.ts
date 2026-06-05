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

function summarizeLoadedPageForLog(page: unknown) {
  const p = page as
    | {
        id?: string;
        title?: string;
        workspaceId?: string;
        databaseId?: string | null;
        deletedAt?: string | null;
        updatedAt?: string | null;
        contentLoaded?: boolean;
        dbCells?: Record<string, unknown> | null;
        doc?: { content?: Array<{ type?: string; attrs?: Record<string, unknown> }> };
      }
    | undefined;
  const first = p?.doc?.content?.[0];
  return {
    id: p?.id ?? null,
    title: p?.title ?? null,
    workspaceId: p?.workspaceId ?? null,
    databaseId: p?.databaseId ?? null,
    deletedAt: p?.deletedAt ?? null,
    updatedAt: p?.updatedAt ?? null,
    contentLoaded: p?.contentLoaded ?? null,
    docNodeCount: p?.doc?.content?.length ?? null,
    firstNodeType: first?.type ?? null,
    firstNodeDatabaseId:
      first?.type === "databaseBlock" ? (first.attrs?.databaseId ?? null) : null,
    firstNodeLayout:
      first?.type === "databaseBlock" ? (first.attrs?.layout ?? null) : null,
    dbCellKeys: p?.dbCells ? Object.keys(p.dbCells).slice(0, 20) : null,
  };
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
        localBefore: summarizeLoadedPageForLog(page),
        metaOnlyBefore: Boolean(state.metaOnlyByPageId[pageId]),
      });
    }
    try {
      const page = await fetchPageById(workspaceId, pageId);
      if (import.meta.env.DEV) {
        console.info("[QN_PAGE_CONTENT] fetch-result", {
          pageId,
          workspaceId,
          source: args.source,
          remote: summarizeLoadedPageForLog(page),
        });
      }
      if (!page) {
        console.warn("[QN_PAGE_CONTENT] load-missing", {
          pageId,
          workspaceId,
          source: args.source,
        });
        return false;
      }
      applyRemotePageToStore(page);
      if (workspaceHasStructureCache(workspaceId)) {
        refreshWorkspaceSnapshot(workspaceId);
      }
      if (import.meta.env.DEV) {
        console.info("[QN_PAGE_CONTENT] load-applied", {
          pageId,
          workspaceId,
          source: args.source,
          localAfter: summarizeLoadedPageForLog(usePageStore.getState().pages[pageId]),
          metaOnlyAfter: Boolean(
            usePageContentLoadStore.getState().metaOnlyByPageId[pageId],
          ),
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
