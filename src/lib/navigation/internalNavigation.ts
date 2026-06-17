import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useUiStore } from "../../store/uiStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { ensurePageContentLoaded } from "../sync/pageContentLoad";
import { requestCrossWorkspaceLanding } from "../sync/workspaceLanding";
import { buildQuickNotePageUrl } from "./quicknoteLinks";
import type { Page } from "../../types/page";

export type InternalNavigationClick = {
  ctrlKey?: boolean;
  metaKey?: boolean;
};

export function shouldOpenInternalLinkInNewTab(event: InternalNavigationClick): boolean {
  return Boolean(event.ctrlKey || event.metaKey);
}

function findPage(pageId: string): Page | null {
  return usePageStore.getState().pages[pageId] ?? null;
}

// 타 워크스페이스 페이지는 워크스페이스를 전환하지 않고 미리보기(peek) 팝업으로 띄운다.
// 현재 탭 구조를 건드리지 않고 해당 페이지만 본다. 실제 전환은 peek 의 "이 워크스페이스로 이동"
// 버튼이 navigateToWorkspacePage() 로 수행한다.
function openCrossWorkspacePeek(pageId: string, targetWorkspaceId: string | null): boolean {
  const currentWorkspaceId = useWorkspaceStore.getState().currentWorkspaceId;
  if (!targetWorkspaceId || targetWorkspaceId === currentWorkspaceId) return false;
  void ensurePageContentLoaded({
    pageId,
    workspaceId: targetWorkspaceId,
    source: "cross-workspace-peek",
  }).then((loaded) => {
    if (loaded) useUiStore.getState().openPeek(pageId);
    else useUiStore.getState().showToast("다른 워크스페이스 페이지를 불러오지 못했습니다.", { kind: "error" });
  });
  return true;
}

function requestWorkspaceNavigationIfNeeded(page: Page): boolean {
  return openCrossWorkspacePeek(page.id, page.workspaceId ?? null);
}

// peek 의 "이 워크스페이스로 이동" 버튼 — 실제 워크스페이스 전환 + 진입 landing 이 first-root 로
// 리셋하는 대신 이 페이지로 결정적으로 착지하도록 요청한다.
export function navigateToWorkspacePage(pageId: string, targetWorkspaceId: string): void {
  if (!targetWorkspaceId || targetWorkspaceId === useWorkspaceStore.getState().currentWorkspaceId) {
    openPageInCurrentTab(pageId);
    return;
  }
  requestCrossWorkspaceLanding(targetWorkspaceId, pageId);
  useWorkspaceStore.getState().setCurrentWorkspaceId(targetWorkspaceId);
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

export function openPageInCurrentTab(
  pageId: string,
  opts?: { workspaceId?: string | null },
): boolean {
  const page = findPage(pageId);
  if (!page) return openCrossWorkspacePeek(pageId, opts?.workspaceId ?? null);
  if (requestWorkspaceNavigationIfNeeded(page)) return true;
  useSettingsStore.getState().setCurrentTabPage(pageId);
  usePageStore.getState().setActivePage(pageId);
  pushPageBrowserHistory(pageId);
  return true;
}

export function openPageInNewTab(
  pageId: string,
  opts?: { workspaceId?: string | null },
): boolean {
  const page = findPage(pageId);
  if (!page) return openCrossWorkspacePeek(pageId, opts?.workspaceId ?? null);
  if (requestWorkspaceNavigationIfNeeded(page)) return true;
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
