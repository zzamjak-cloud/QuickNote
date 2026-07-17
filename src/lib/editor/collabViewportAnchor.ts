import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  isLikelyVerticalScrollbarInput,
  markProgrammaticScroll,
  suppressScrollRestoreFor,
} from "../navigation/pageScrollMemory";

type AnchorEditorView = Pick<EditorView, "dom" | "nodeDOM" | "state">;

export type CollaborationViewportAnchor = {
  blockId: string | null;
  element: HTMLElement;
  offsetTop: number;
};

const ANCHOR_EPSILON_PX = 1;
const DEFAULT_STABILIZE_MS = 3000;

function topLevelSelectionPos(state: EditorState): number {
  const { $from } = state.selection;
  return $from.depth > 0 ? $from.before(1) : state.selection.from;
}

function asBlockElement(node: Node | null, editorDom: HTMLElement): HTMLElement | null {
  const element =
    node instanceof HTMLElement
      ? node
      : node instanceof Text
        ? node.parentElement
        : null;
  if (!element) return null;
  const block = element.matches("[data-id]")
    ? element
    : element.closest<HTMLElement>("[data-id]");
  return block && editorDom.contains(block) ? block : null;
}

function firstVisibleBlock(editorDom: HTMLElement, scroller: HTMLElement): HTMLElement | null {
  const viewport = scroller.getBoundingClientRect();
  return (
    Array.from(editorDom.querySelectorAll<HTMLElement>("[data-id]")).find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom > viewport.top && rect.top < viewport.bottom;
    }) ?? null
  );
}

function findBlockById(
  editorDom: HTMLElement,
  anchor: CollaborationViewportAnchor,
): HTMLElement | null {
  if (anchor.blockId) {
    const matching = Array.from(
      editorDom.querySelectorAll<HTMLElement>("[data-id]"),
    ).find((element) => element.dataset.id === anchor.blockId);
    if (matching) return matching;
  }
  return anchor.element.isConnected && editorDom.contains(anchor.element)
    ? anchor.element
    : null;
}

export function findEditorScrollHost(editorDom: HTMLElement): HTMLElement | null {
  return editorDom.closest<HTMLElement>(".qn-editor-body-scroll");
}

/** 원격 문서 변경 직전, 현재 편집 블록의 viewport 기준 위치를 캡처한다. */
export function captureCollaborationViewportAnchor(
  view: AnchorEditorView,
  scroller: HTMLElement,
): CollaborationViewportAnchor | null {
  if (scroller.scrollTop <= 0) return null;
  const selectionNode = view.nodeDOM(topLevelSelectionPos(view.state));
  const selectedBlock = asBlockElement(selectionNode, view.dom);
  const block = selectedBlock ?? firstVisibleBlock(view.dom, scroller);
  if (!block) return null;

  const viewport = scroller.getBoundingClientRect();
  const rect = block.getBoundingClientRect();
  if (rect.bottom <= viewport.top || rect.top >= viewport.bottom) return null;
  return {
    blockId: block.dataset.id ?? null,
    element: block,
    offsetTop: rect.top - viewport.top,
  };
}

/** 원격 변경 뒤 같은 블록이 화면에서 차지하던 위치만큼 scrollTop을 보정한다. */
export function restoreCollaborationViewportAnchor(
  view: Pick<EditorView, "dom">,
  scroller: HTMLElement,
  anchor: CollaborationViewportAnchor,
): boolean {
  const block = findBlockById(view.dom, anchor);
  if (!block) return false;
  const viewport = scroller.getBoundingClientRect();
  const currentOffset = block.getBoundingClientRect().top - viewport.top;
  const delta = currentOffset - anchor.offsetTop;
  if (Math.abs(delta) <= ANCHOR_EPSILON_PX) return true;

  const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  markProgrammaticScroll();
  suppressScrollRestoreFor(scroller);
  scroller.scrollTop = Math.max(0, Math.min(maxTop, scroller.scrollTop + delta));
  return true;
}

/**
 * lazy 이미지가 placeholder에서 실제 크기로 바뀌는 후속 레이아웃까지 같은 블록을 고정한다.
 * 사용자의 직접 스크롤이나 로컬 편집이 시작되면 호출자가 즉시 정리할 수 있다.
 */
export function stabilizeCollaborationViewportAnchor(
  view: Pick<EditorView, "dom">,
  scroller: HTMLElement,
  anchor: CollaborationViewportAnchor,
  timeoutMs = DEFAULT_STABILIZE_MS,
): () => void {
  let stopped = false;
  let frameId: number | null = null;
  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => scheduleRestore());

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (frameId != null) window.cancelAnimationFrame(frameId);
    resizeObserver?.disconnect();
    window.clearTimeout(timeoutId);
    scroller.removeEventListener("wheel", stop);
    scroller.removeEventListener("touchmove", stop);
    scroller.removeEventListener("pointerdown", onPointerDown);
    scroller.removeEventListener("mousedown", onPointerDown);
  };

  const restore = () => {
    frameId = null;
    if (stopped) return;
    if (!restoreCollaborationViewportAnchor(view, scroller, anchor)) stop();
  };

  function scheduleRestore(): void {
    if (stopped || frameId != null) return;
    frameId = window.requestAnimationFrame(restore);
  }

  const onPointerDown = (event: MouseEvent | PointerEvent) => {
    if (event.button !== 0) return;
    if (isLikelyVerticalScrollbarInput(event, scroller)) stop();
  };

  const timeoutId = window.setTimeout(stop, timeoutMs);
  scroller.addEventListener("wheel", stop, { passive: true });
  scroller.addEventListener("touchmove", stop, { passive: true });
  scroller.addEventListener("pointerdown", onPointerDown, { passive: true });
  scroller.addEventListener("mousedown", onPointerDown, { passive: true });
  resizeObserver?.observe(view.dom);
  restore();
  return stop;
}
