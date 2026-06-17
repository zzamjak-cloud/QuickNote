import { usePageContentLoadStore } from "../../store/pageContentLoadStore";
import { usePageStore } from "../../store/pageStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { fetchPageById } from "./bootstrap";
import { applyRemotePageToStore } from "./storeApply";
import { gqlPageToLocalPage } from "./storeApply/helpers";
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
      // 타 워크스페이스 페이지(미리보기 peek·타 워크스페이스 인라인 DB 행 등): storeApply 의 워크스페이스
      // 가드가 page.workspaceId 기준으로 원격 데이터를 무시하므로, 가져온 페이지의 실제 워크스페이스가
      // 현재와 다르면(요청 workspaceId 와 무관하게) 가드를 우회해 현재 store 에 직접 적재한다.
      // workspaceId 가 달라 사이드바·동기화 대상에선 자동 제외된다.
      if (page.workspaceId && page.workspaceId !== useWorkspaceStore.getState().currentWorkspaceId) {
        const local = gqlPageToLocalPage(page);
        usePageStore.setState((s) => ({
          pages: { ...s.pages, [local.id]: { ...s.pages[local.id], ...local } },
        }));
        return true;
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
