import { usePageStore, isFullPageDatabaseHomePage } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import type { PageMap } from "../../types/page";

/**
 * 사이드바 루트 목록에서 첫 번째( order 기준 ) 일반 페이지 id.
 * DB 행 페이지·DB 풀페이지 전용 홈은 제외.
 */
export function getFirstRootSidebarPageId(pages: PageMap): string | null {
  const roots = Object.values(pages)
    .filter(
      (p) =>
        p.parentId === null &&
        p.databaseId == null &&
        !isFullPageDatabaseHomePage(p),
    )
    .sort((a, b) => a.order - b.order);
  return roots[0]?.id ?? null;
}

/**
 * 워크스페이스 데이터 페치 직후: 탭이 비어 있거나 삭제된 페이지를 가리키면
 * 마지막 방문 페이지(있으면) 또는 루트 첫 페이지로 맞춘다.
 * 탭이 이미 유효한 페이지를 가리키면(새로고침 등) 건드리지 않고 방문 기록만 동기화한다.
 */
export function applyWorkspaceLanding(workspaceId: string): void {
  if (!workspaceId) return;
  const settings = useSettingsStore.getState();
  const { pages, setActivePage } = usePageStore.getState();
  const tabPageId =
    settings.tabs[settings.activeTabIndex]?.pageId ?? null;
  if (tabPageId && pages[tabPageId]) {
    settings.setLastVisitedPageForWorkspace(workspaceId, tabPageId);
    return;
  }
  const remembered =
    settings.lastVisitedPageIdByWorkspaceId[workspaceId] ?? null;
  let target: string | null =
    remembered && pages[remembered] ? remembered : null;
  if (!target) target = getFirstRootSidebarPageId(pages);
  settings.replaceCurrentTabPage(target);
  setActivePage(target);
}
