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

// 크로스 워크스페이스 진입 목표 — 타 워크스페이스 페이지를 풀페이지로 열 때, 워크스페이스 전환
// 진입 landing 이 first-root 로 강제 리셋하는 대신 클릭한 목표 페이지로 결정적으로 착지하게 한다.
// 전환 중 applyRemote→landing 이 여러 번 실행돼도 항상 목표로 수렴한다(사후 네비 레이스 제거).
let pendingCrossWorkspaceLanding: { workspaceId: string; pageId: string } | null = null;

export function requestCrossWorkspaceLanding(workspaceId: string, pageId: string): void {
  pendingCrossWorkspaceLanding = { workspaceId, pageId };
}

export function clearCrossWorkspaceLanding(): void {
  pendingCrossWorkspaceLanding = null;
}

// 진입 landing 에서 활성/마지막 페이지로 복원해도 안전한지 — 유령 페이지(풀페이지 DB 홈)·
// 보호 DB 블록·타 워크스페이스 페이지를 배제한다. pageBelongsToWorkspace 가 후자 둘을 거른다.
function isRestorableLandingPage(
  page: PageMap[string] | undefined,
  workspaceId: string,
): boolean {
  if (!page) return false;
  if (!pageBelongsToWorkspace(page, workspaceId)) return false;
  if (isFullPageDatabaseHomePage(page)) return false;
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

  // 크로스 워크스페이스 진입 목표가 있으면 first-root 대신 목표 페이지로 착지한다.
  // forceFirstRoot 와 동일하게 활성 탭을 교체하므로(풀페이지 DB 탭 복원 회귀 방지) 유령 페이지 위험은 없다.
  if (pendingCrossWorkspaceLanding) {
    if (pendingCrossWorkspaceLanding.workspaceId !== workspaceId) {
      // 다른 워크스페이스로 진입 → 스테일 목표 폐기
      pendingCrossWorkspaceLanding = null;
    } else if (pageBelongsToWorkspace(pages[pendingCrossWorkspaceLanding.pageId], workspaceId)) {
      const target = pendingCrossWorkspaceLanding.pageId;
      settings.replaceCurrentTabPage(target);
      setActivePage(target);
      settings.setLastVisitedPageForWorkspace(workspaceId, target);
      return;
    }
    // 목표 페이지가 아직 로드되지 않았으면 이번엔 first-root 로 폴백하고, 다음 landing 에서 재시도한다.
  }

  // 워크스페이스 전환/재진입: 직전에 보던 페이지를 복원하되, 유령 페이지를 만드는 탭만 무력화한다.
  // - 안전한 일반 페이지(현재 WS 소속·DB 탭/풀페이지 DB 홈/보호 DB 블록 아님)면 그대로 유지해
  //   사용자가 보던 위치를 복원한다.
  // - DB 탭/풀페이지 DB 홈을 활성 탭으로 복원하면 ensureFullPagePageForDatabase 가 홈을 재생성(유령)하므로
  //   마지막 방문 페이지(안전 시) 또는 첫 인덱스 페이지로 대체한다. (유령 방지 가드 유지)
  if (options.forceFirstRoot) {
    const activeTab = settings.tabs[settings.activeTabIndex];
    const activeTabPageId = activeTab?.pageId ?? null;
    if (
      !activeTab?.databaseId &&
      activeTabPageId &&
      isRestorableLandingPage(pages[activeTabPageId], workspaceId)
    ) {
      setActivePage(activeTabPageId);
      settings.setLastVisitedPageForWorkspace(workspaceId, activeTabPageId);
      return;
    }
    const remembered = settings.lastVisitedPageIdByWorkspaceId[workspaceId] ?? null;
    const target =
      remembered && isRestorableLandingPage(pages[remembered], workspaceId)
        ? remembered
        : getFirstRootSidebarPageId(pages, workspaceId);
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
