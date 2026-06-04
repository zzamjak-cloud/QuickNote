import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { buildQuickNotePageUrl } from "./quicknoteLinks";

export type InternalNavigationClick = {
  ctrlKey?: boolean;
  metaKey?: boolean;
};

export function shouldOpenInternalLinkInNewTab(event: InternalNavigationClick): boolean {
  return Boolean(event.ctrlKey || event.metaKey);
}

function pageExists(pageId: string): boolean {
  return Boolean(usePageStore.getState().pages[pageId]);
}

/**
 * 현재 탭 내부 페이지 이동을 브라우저 히스토리에 기록한다.
 * 이렇게 해야 브라우저 뒤로가기가 앱을 벗어나지 않고 이전 페이지로 돌아온다
 * (popstate → App.tsx 의 applyLocationLink 가 URL 의 ?page 를 읽어 복원).
 */
function pushPageBrowserHistory(pageId: string): void {
  if (typeof window === "undefined") return;
  try {
    const current = new URLSearchParams(window.location.search).get("page");
    if (current === pageId) return; // 같은 페이지면 중복 히스토리 엔트리 방지
    window.history.pushState(
      { qnPage: pageId },
      "",
      buildQuickNotePageUrl({ pageId }),
    );
  } catch {
    /* noop */
  }
}

export function openPageInCurrentTab(pageId: string): boolean {
  if (!pageExists(pageId)) return false;
  useSettingsStore.getState().setCurrentTabPage(pageId);
  usePageStore.getState().setActivePage(pageId);
  pushPageBrowserHistory(pageId);
  return true;
}

export function openPageInNewTab(pageId: string): boolean {
  if (!pageExists(pageId)) return false;
  useSettingsStore.getState().openTab(pageId);
  usePageStore.getState().setActivePage(pageId);
  return true;
}

export function openDatabaseInCurrentTab(databaseId: string): void {
  useSettingsStore.getState().setCurrentTabDatabase(databaseId);
  usePageStore.getState().setActivePage(null);
}

export function openDatabaseInNewTab(databaseId: string): void {
  useSettingsStore.getState().openDatabaseTab(databaseId);
  usePageStore.getState().setActivePage(null);
}
