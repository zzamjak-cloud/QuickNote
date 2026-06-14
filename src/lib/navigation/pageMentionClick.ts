import { usePageStore } from "../../store/pageStore";
import { useUiStore } from "../../store/uiStore";
import { useNavigationHistoryStore } from "../../store/navigationHistoryStore";
import {
  openPageInCurrentTab,
  openPageInNewTab,
  shouldOpenInternalLinkInNewTab,
} from "./internalNavigation";
import {
  isDatabaseMention,
  isMemberMention,
  stripPagePrefix,
} from "../tiptapExtensions/mentionKind";

type PagePress = {
  x: number;
  y: number;
  id: string;
  inPeek: boolean;
};

let pagePress: PagePress | null = null;

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
    useUiStore.getState().peekNavigate(press.id);
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
    if (event.button !== 0) return;
    pagePress = resolvePageMentionPress(event.target, event.clientX, event.clientY);
  };

  const onMouseUp = (event: MouseEvent) => {
    const press = pagePress;
    pagePress = null;
    if (!press || event.button !== 0) return;
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

  document.addEventListener("mousedown", onMouseDown, true);
  document.addEventListener("mouseup", onMouseUp, true);
  return () => {
    document.removeEventListener("mousedown", onMouseDown, true);
    document.removeEventListener("mouseup", onMouseUp, true);
    pagePress = null;
  };
}
