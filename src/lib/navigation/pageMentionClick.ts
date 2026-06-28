import { usePageStore } from "../../store/pageStore";
import { useUiStore } from "../../store/uiStore";
import { useNavigationHistoryStore } from "../../store/navigationHistoryStore";
import {
  openPageInCurrentTab,
  openPageInNewTab,
  peekNavigateToPage,
  shouldOpenInternalLinkInNewTab,
} from "./internalNavigation";
import {
  isDatabaseMention,
  isMemberMention,
  stripPagePrefix,
} from "../tiptapExtensions/mentionKind";
import {
  navigateButtonBlock,
  resolveButtonPress,
  type ButtonPress,
} from "./buttonBlockClick";
import { parseQuickNoteLink } from "./quicknoteLinks";

// 일반 텍스트 링크(link mark, a[href]) 중 내부 링크(?page=…)도 멘션·버튼과 동일 위임으로 SPA 이동.
// @tiptap/extension-link 는 openOnClick:false 라 자체 클릭 핸들러가 없다(외부는 target=_blank native).
function resolveInternalLinkPress(
  target: EventTarget | null,
  x: number,
  y: number,
): ButtonPress | null {
  if (!(target instanceof HTMLElement)) return null;
  const a = target.closest<HTMLElement>("a[href]");
  if (!a || !a.closest(".ProseMirror")) return null;
  // 멘션·블록 링크 버튼은 각자 처리하므로 제외.
  if (a.closest("[data-qn-button-block]") || a.closest('[data-type="mention"]')) return null;
  const href = a.getAttribute("href") ?? "";
  // 내부 링크(quicknote ?page=…)만 SPA 처리. 외부 URL 은 native target=_blank 에 맡긴다(중복 방지).
  if (!parseQuickNoteLink(href)) return null;
  return { x, y, href, databaseId: "" };
}

type PagePress = {
  x: number;
  y: number;
  id: string;
  inPeek: boolean;
};

let pagePress: PagePress | null = null;
// 블록 링크 버튼도 멘션과 동일한 단일 document 위임으로 처리(모바일/설치 PWA 안정).
let btnPress: ButtonPress | null = null;

function resolvePageMentionPress(
  target: EventTarget | null,
  clientX: number,
  clientY: number,
): PagePress | null {
  if (!(target instanceof HTMLElement)) return null;
  const el = target.closest<HTMLElement>('[data-type="mention"][data-id]');
  if (!el?.closest(".ProseMirror")) return null;
  const rawId = el.getAttribute("data-id");
  if (!rawId) return null;
  const kindAttr = el.getAttribute("data-mention-kind");
  if (isMemberMention(rawId, kindAttr)) return null;
  if (isDatabaseMention(rawId, kindAttr)) return null;
  const pageId = stripPagePrefix(rawId);
  if (!pageId) return null;
  return {
    x: clientX,
    y: clientY,
    id: pageId,
    inPeek: !!el.closest("[data-qn-peek-editor='true']"),
  };
}

function navigateToMentionedPage(press: PagePress, event: MouseEvent): void {
  if (shouldOpenInternalLinkInNewTab(event)) {
    openPageInNewTab(press.id);
    return;
  }
  if (press.inPeek && useUiStore.getState().peekPageId) {
    peekNavigateToPage(press.id);
    return;
  }
  const fromId = usePageStore.getState().activePageId;
  if (fromId && fromId !== press.id) {
    useNavigationHistoryStore.getState().pushBack(fromId, press.id);
  }
  openPageInCurrentTab(press.id);
}

/**
 * 페이지 멘션 클릭 이동 — document capture mousedown/mouseup.
 * NodeView 재마운트로 click 이 깨지는 경우에도 mouseup 은 document 에서 수신된다.
 */
export function installPageMentionClickNavigation(): () => void {
  const onMouseDown = (event: MouseEvent) => {
    pagePress = null;
    btnPress = null;
    if (event.button !== 0) return;
    pagePress = resolvePageMentionPress(event.target, event.clientX, event.clientY);
    if (!pagePress) {
      btnPress =
        resolveButtonPress(event.target, event.clientX, event.clientY) ??
        resolveInternalLinkPress(event.target, event.clientX, event.clientY);
    }
  };

  const onMouseUp = (event: MouseEvent) => {
    const press = pagePress;
    const button = btnPress;
    pagePress = null;
    btnPress = null;
    if (event.button !== 0) return;
    // 블록 링크 버튼 — 멘션과 동일 경로(거리 가드 후 네비게이션).
    if (button) {
      if (
        Math.abs(event.clientX - button.x) > 4 ||
        Math.abs(event.clientY - button.y) > 4
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      navigateButtonBlock(button, event);
      return;
    }
    if (!press) return;
    if (
      Math.abs(event.clientX - press.x) > 4 ||
      Math.abs(event.clientY - press.y) > 4
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    navigateToMentionedPage(press, event);
  };

  // 내부 링크 mark(a[href] ?page=…)는 mouseup 에서 SPA 이동을 처리한다. 하지만 <a target="_blank">
  // 의 native click 이 그대로 발화하면 웹 페이지가 새 탭에 함께 떠 "이중 페이지"가 된다.
  // 내부 링크 click 을 가로채 native 동작을 차단한다(외부 링크는 그대로 native 처리).
  const onClick = (event: MouseEvent) => {
    if (resolveInternalLinkPress(event.target, event.clientX, event.clientY)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  document.addEventListener("mousedown", onMouseDown, true);
  document.addEventListener("mouseup", onMouseUp, true);
  document.addEventListener("click", onClick, true);
  return () => {
    document.removeEventListener("mousedown", onMouseDown, true);
    document.removeEventListener("mouseup", onMouseUp, true);
    document.removeEventListener("click", onClick, true);
    pagePress = null;
  };
}
