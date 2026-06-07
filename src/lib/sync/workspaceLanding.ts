import {
  usePageStore,
  isFullPageDatabaseHomePage,
  isProtectedDatabaseBlockPage,
} from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { LC_SCHEDULER_WORKSPACE_ID } from "../scheduler/scope";
import type { PageMap } from "../../types/page";

/**
 * 사이드바 루트 목록에서 첫 번째( order 기준 ) 일반 페이지 id.
 * DB 행 페이지·DB 풀페이지 전용 홈은 제외.
 */
function pageBelongsToWorkspace(
  page: PageMap[string] | undefined,
  workspaceId: string,
): boolean {
  if (!page) return false;
  if (page.workspaceId && page.workspaceId !== workspaceId) return false;
  if (
    workspaceId !== LC_SCHEDULER_WORKSPACE_ID &&
    isProtectedDatabaseBlockPage(page)
  ) {
    return false;
  }
  return true;
}

export function getFirstRootSidebarPageId(
  pages: PageMap,
  workspaceId: string,
): string | null {
  const roots = Object.values(pages)
    .filter(
      (p) =>
        pageBelongsToWorkspace(p, workspaceId) &&
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
export function applyWorkspaceLanding(
  workspaceId: string,
  options: { forceFirstRoot?: boolean } = {},
): void {
  if (!workspaceId) return;
  const settings = useSettingsStore.getState();
  const { pages, setActivePage } = usePageStore.getState();

  // 워크스페이스 전환 진입: 직전에 보던 상태(원본 풀페이지 DB 탭·마지막 방문 페이지)를
  // 복원하지 않고 항상 첫 인덱스 페이지로 리셋한다. 풀페이지 DB 탭을 복원하면
  // ensureFullPagePageForDatabase 가 메타 상태에서 홈을 재생성해 데이터가 꼬이므로,
  // 진입 화면을 결정적으로 고정해 회귀를 차단한다.
  if (options.forceFirstRoot) {
    const target = getFirstRootSidebarPageId(pages, workspaceId);
    settings.replaceCurrentTabPage(target);
    setActivePage(target);
    if (target) settings.setLastVisitedPageForWorkspace(workspaceId, target);
    return;
  }

  const activeTab = settings.tabs[settings.activeTabIndex];
  // DirectPage 탭(원본 DB 전체 페이지)은 pageId 가 null 이고 databaseId 로 식별된다.
  // 이미 유효한 탭이므로 landing 으로 덮어쓰지 않는다(새로고침 시 사이드바 인라인 DB 로 튕기는 회귀 방지).
  if (activeTab?.databaseId) {
    return;
  }
  const tabPageId = activeTab?.pageId ?? null;
  if (tabPageId && pageBelongsToWorkspace(pages[tabPageId], workspaceId)) {
    settings.setLastVisitedPageForWorkspace(workspaceId, tabPageId);
    return;
  }
  const remembered =
    settings.lastVisitedPageIdByWorkspaceId[workspaceId] ?? null;
  let target: string | null =
    remembered && pageBelongsToWorkspace(pages[remembered], workspaceId)
      ? remembered
      : null;
  if (!target) target = getFirstRootSidebarPageId(pages, workspaceId);
  settings.replaceCurrentTabPage(target);
  setActivePage(target);
}
