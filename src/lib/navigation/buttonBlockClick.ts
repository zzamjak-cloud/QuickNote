// 블록 링크 버튼 네비게이션 — document 위임(capture mousedown/mouseup).
// 멘션/링크(pageMentionClick)와 동일 메커니즘: NodeView 재마운트·모바일 터치(설치 PWA 포함)에서
// 버튼 자체의 React onClick/pointerup 이 깨져도 document 의 mouseup 은 안정적으로 수신된다.
// (모바일에서 일반 페이지 링크·멘션은 되는데 블록 링크 버튼만 안 되던 원인.)
import { usePageStore } from "../../store/pageStore";
import { useNavigationHistoryStore } from "../../store/navigationHistoryStore";
import { parseQuickNoteLink } from "./quicknoteLinks";
import {
  openDatabaseInCurrentTab,
  openDatabaseInNewTab,
  openPageInCurrentTab,
  openPageInNewTab,
  shouldOpenInternalLinkInNewTab,
} from "./internalNavigation";
import { navigateToBlockLink } from "../editor/editorNavigationBridge";

export type ButtonPress = { x: number; y: number; href: string; databaseId: string };

export function resolveButtonPress(
  target: EventTarget | null,
  x: number,
  y: number,
): ButtonPress | null {
  if (!(target instanceof HTMLElement)) return null;
  const el = target.closest<HTMLElement>("[data-qn-button-block]");
  if (!el?.closest(".ProseMirror")) return null;
  return {
    x,
    y,
    href: el.getAttribute("data-href") ?? "",
    databaseId: el.getAttribute("data-database-id") ?? "",
  };
}

export function navigateButtonBlock(press: ButtonPress, event: MouseEvent): void {
  const href = press.href.trim();
  const internalHref = href ? parseQuickNoteLink(href) : null;
  const newTab = shouldOpenInternalLinkInNewTab(event);
  if (internalHref) {
    const applyTab = () => {
      if (!internalHref.tab) return;
      document
        .querySelector<HTMLButtonElement>(
          `[data-qn-tab-id="${CSS.escape(internalHref.tab)}"]`,
        )
        ?.click();
    };
    const hasBlockTarget = internalHref.blockId != null || internalHref.block != null;
    const goBlock = (pageId: string) => {
      if (hasBlockTarget) {
        navigateToBlockLink(pageId, {
          blockId: internalHref.blockId,
          blockPos: internalHref.block,
        });
      }
    };
    if (newTab) {
      if (!openPageInNewTab(internalHref.pageId, { workspaceId: internalHref.workspaceId })) return;
      goBlock(internalHref.pageId);
      window.setTimeout(applyTab, 80);
      return;
    }
    const currentPageId = usePageStore.getState().activePageId;
    if (currentPageId && currentPageId !== internalHref.pageId) {
      // 도착 페이지를 함께 기록 → 일반 페이지에서도 헤더 '이전 페이지' 백스택 유지.
      useNavigationHistoryStore.getState().pushBack(currentPageId, internalHref.pageId);
    }
    if (!openPageInCurrentTab(internalHref.pageId, { workspaceId: internalHref.workspaceId })) return;
    goBlock(internalHref.pageId);
    window.setTimeout(applyTab, 80);
    return;
  }
  if (href) {
    const targetHref = href.startsWith("http") ? href : `https://${href}`;
    window.open(targetHref, "_blank", "noopener,noreferrer");
    return;
  }
  if (press.databaseId) {
    if (newTab) {
      openDatabaseInNewTab(press.databaseId);
      return;
    }
    const currentPageId = usePageStore.getState().activePageId;
    if (currentPageId) useNavigationHistoryStore.getState().pushBack(currentPageId);
    openDatabaseInCurrentTab(press.databaseId);
  }
}

// 설치는 pageMentionClick 의 단일 document 리스너가 멘션과 함께 처리한다(동일 경로 보장).
