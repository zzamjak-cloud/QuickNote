import { type RefObject, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import { TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { topLevelBlockStartsInSelectionRange } from "../../lib/pm/topLevelBlocks";
import { MARQUEE_ACTIVATE_PX } from "./constants";
import type { Rect } from "./types";
import {
  hideGroupOverlay,
  paintOverlayForPositions,
} from "./overlayDom";
import { isGroupOverlayTarget } from "./hitTest";
import { applyBoxMarqueeElementStyle } from "../../lib/boxSelectionVisual";

type Args = {
  editor: Editor | null;
  startRef: RefObject<{ x: number; y: number } | null>;
  activeRef: RefObject<boolean>;
  dragRectRef: RefObject<Rect | null>;
  selectedStartsRef: RefObject<number[]>;
  clearSelection: () => void;
  setSelectedStarts: (v: number[]) => void;
  updateSelectionDom: (rect: Rect) => void;
};

const ENABLE_BOX_SELECT_MARQUEE = true;

/** 노션 스타일 — 포인터가 PM doc 직속 블럭(또는 그 후손) 위인지 검사.
 *  ProseMirror 루트 padding(px-12 등)은 elementFromPoint 가 view.dom 을 반환 → 마퀴 허용. */
function isInsideAnyBlock(
  view: EditorView,
  clientX: number,
  clientY: number,
): boolean {
  const hit = document.elementFromPoint(clientX, clientY);
  if (!hit || !(hit instanceof Element)) return false;
  if (!view.dom.contains(hit)) return false;
  if (hit === view.dom) return false;

  let el: Element | null = hit;
  while (el && el !== view.dom) {
    if (el.parentElement === view.dom) return true;
    el = el.parentElement;
  }
  return false;
}

/** 마퀴 드래그 — 블럭 외부 빈 공간 전용. 그룹 오버레이는 시각 표시만(이동은 그립 핸들러 전용). */
export function useBoxSelectMarquee({
  editor,
  startRef,
  activeRef,
  dragRectRef,
  selectedStartsRef,
  clearSelection,
  setSelectedStarts,
  updateSelectionDom,
}: Args): void {
  useEffect(() => {
    // 박스 드래그는 유지하되, 본문 텍스트 블럭 내부 드래그 선택은 onMouseDown 분기에서
    // PM 기본 텍스트 선택으로 위임해 세로 스크롤 간섭을 줄인다.
    if (!ENABLE_BOX_SELECT_MARQUEE) return;
    if (!editor || editor.isDestroyed) return;
    const columnHost =
      editor.view.dom.closest<HTMLElement>("[data-qn-editor-column]") ??
      editor.view.dom.parentElement;
    const bodyScrollHost =
      editor.view.dom.closest<HTMLElement>(".qn-editor-body-scroll");
    const editorHost =
      bodyScrollHost ??
      editor.view.dom.closest<HTMLElement>(".overflow-y-auto") ??
      columnHost;
    const peekHost = editor.view.dom.closest<HTMLElement>("[data-qn-peek-editor='true']");
    const peekEditorHost = editor.view.dom.closest<HTMLElement>(".qn-peek-editor");
    // mx-auto 컬럼 바깥 좌·우 여백(스크롤 패널)에서도 마퀴가 시작되도록 스크롤 호스트까지 포함
    const marqueeScopeHost =
      peekEditorHost ?? peekHost ?? bodyScrollHost ?? editorHost ?? columnHost;
    if (!editorHost) return;

    const dragRectOverlay = document.createElement("div");
    dragRectOverlay.className = "qn-box-select-rect";
    applyBoxMarqueeElementStyle(dragRectOverlay);
    dragRectOverlay.style.display = "none";
    dragRectOverlay.setAttribute("aria-hidden", "true");
    document.body.appendChild(dragRectOverlay);
    let lockedScroll: { left: number; top: number } | null = null;

    const showDragOverlay = (r: Rect) => {
      if (Math.max(r.w, r.h) < 1) {
        dragRectOverlay.style.display = "none";
        return;
      }
      if (!dragRectOverlay.isConnected) {
        document.body.appendChild(dragRectOverlay);
      }
      dragRectOverlay.style.display = "block";
      dragRectOverlay.style.left = `${r.x}px`;
      dragRectOverlay.style.top = `${r.y}px`;
      dragRectOverlay.style.width = `${Math.max(r.w, 1)}px`;
      dragRectOverlay.style.height = `${Math.max(r.h, 1)}px`;
    };

    const hideDragOverlay = () => {
      dragRectOverlay.style.display = "none";
    };

    const lockEditorScroll = () => {
      lockedScroll = {
        left: editorHost.scrollLeft,
        top: editorHost.scrollTop,
      };
    };

    const restoreLockedScroll = () => {
      if (!lockedScroll) return;
      if (
        editorHost.scrollTop !== lockedScroll.top ||
        editorHost.scrollLeft !== lockedScroll.left
      ) {
        editorHost.scrollTo({
          left: lockedScroll.left,
          top: lockedScroll.top,
          behavior: "instant",
        });
      }
    };

    const endMarqueeChrome = () => {
      document.body.classList.remove("qn-box-select-dragging");
      document.body.classList.remove("qn-box-select-tracking");
      lockedScroll = null;
    };

    const resetMarqueeState = () => {
      startRef.current = null;
      activeRef.current = false;
      dragRectRef.current = null;
      hideDragOverlay();
      endMarqueeChrome();
      document.removeEventListener("selectstart", onSelectStartWhileTracking, true);
    };

    const onSelectStartWhileTracking = (e: Event) => {
      if (!startRef.current) return;
      const t = e.target;
      if (t instanceof Node && editorHost.contains(t)) {
        e.preventDefault();
      }
    };

    const collapsePmSelectionIfNeeded = () => {
      const sel = editor.state.selection;
      if (sel.from !== sel.to || sel instanceof CellSelection) {
        try {
          const doc = editor.state.doc;
          const safePos = Math.min(Math.max(sel.from, 0), doc.content.size);
          const $safe = doc.resolve(safePos);
          const nextSelection =
            TextSelection.findFrom($safe, 1, true) ??
            TextSelection.findFrom($safe, -1, true);
          if (!nextSelection) return;
          editor.view.dispatch(
            editor.state.tr.setSelection(
              nextSelection,
            ),
          );
        } catch {
          // 테이블 경계/루트 경계 위치에서 커서 보정 실패 시 무시
        }
      }
    };

    const beginMarqueeTracking = (ev: MouseEvent) => {
      ev.preventDefault();
      clearSelection();
      lockEditorScroll();
      startRef.current = { x: ev.clientX, y: ev.clientY };
      activeRef.current = false;
      document.body.classList.add("qn-box-select-tracking");
      getSelection()?.removeAllRanges();
      document.addEventListener("selectstart", onSelectStartWhileTracking, true);
    };

    /** 마퀴 시작이 절대 안되어야 하는 인터랙션 요소 (폼·링크·버튼·그립·팝업 등). */
    /** BlockHandles(댓글 배지·그립 등)는 PM view.dom 밖이라 isInsideAnyBlock 이 false — 크롬 루트로 제외 */
    const INTERACTIVE_SELECTOR =
      "input, textarea, select, button, a[href], label, [contenteditable], " +
      "[data-qn-block-grip], [data-qn-editor-chrome], [data-qn-page-comment], .tippy-box, [role='menu'], [role='listbox'], [role='dialog']";

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target;
      if (!(target instanceof Element)) return;

      // 에디터/컬럼 범위 외부 — 선택 해제 후 종료
      // (피커뷰/전체너비 좌우 여백은 컬럼 범위 안으로 보고 박스 드래그를 허용해야 한다)
      if (!marqueeScopeHost?.contains(target)) {
        collapsePmSelectionIfNeeded();
        clearSelection();
        return;
      }

      // 그룹 오버레이는 pointer-events:none 이라 도달하지 않지만 방어
      if (isGroupOverlayTarget(target)) return;

      // 인터랙션 요소 — 마퀴 시작 금지(선택 유지).
      // ProseMirror 루트도 contenteditable 이므로 그 자체는 빈 패딩 시작점으로 허용한다.
      const interactiveTarget = target.closest(INTERACTIVE_SELECTOR);
      if (interactiveTarget && interactiveTarget !== editor.view.dom) return;

      // 블럭 컨텐츠 안 — 노션처럼 마퀴 시작 차단.
      // 박스 선택이 있다면 클리어(클릭 → cursor 이동 시 자연스러운 해제).
      if (isInsideAnyBlock(editor.view, e.clientX, e.clientY)) {
        if (selectedStartsRef.current.length > 0) {
          clearSelection();
        }
        return;
      }

      // 외부 빈 공간(에디터 chrome / 블럭 사이 padding 등) — 마퀴 시작
      collapsePmSelectionIfNeeded();
      beginMarqueeTracking(e);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!startRef.current) return;
      e.preventDefault();
      restoreLockedScroll();
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;

      if (
        !activeRef.current &&
        Math.sqrt(dx * dx + dy * dy) < MARQUEE_ACTIVATE_PX
      ) {
        return;
      }
      if (!activeRef.current) {
        activeRef.current = true;
        document.body.classList.add("qn-box-select-dragging");
        getSelection()?.removeAllRanges();
        collapsePmSelectionIfNeeded();
      } else if (editor.state.selection instanceof CellSelection) {
        // 마퀴가 테이블 위를 지나는 동안 PM이 CellSelection을 재생성하는 것을 막음
        collapsePmSelectionIfNeeded();
      }

      const rect: Rect = {
        x: Math.min(e.clientX, startRef.current.x),
        y: Math.min(e.clientY, startRef.current.y),
        w: Math.abs(dx),
        h: Math.abs(dy),
      };
      dragRectRef.current = rect;
      showDragOverlay(rect);
      updateSelectionDom(rect);
      restoreLockedScroll();
    };

    const onMouseUp = (e: MouseEvent) => {
      const wasTracking = startRef.current !== null;
      const wasActive = activeRef.current;
      if (wasTracking) {
        e.preventDefault();
        restoreLockedScroll();
      }
      const lastRect = dragRectRef.current;
      startRef.current = null;
      if (wasTracking && wasActive && lastRect) {
        updateSelectionDom(lastRect);
      }
      dragRectRef.current = null;
      hideDragOverlay();
      endMarqueeChrome();
      document.removeEventListener("selectstart", onSelectStartWhileTracking, true);
      if (wasTracking && wasActive) {
        setSelectedStarts([...selectedStartsRef.current]);
      } else if (wasTracking && !wasActive) {
        clearSelection();
      }
      activeRef.current = false;
    };

    const onWindowBlur = () => {
      if (!startRef.current && !activeRef.current) return;
      resetMarqueeState();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") return;
      resetMarqueeState();
    };

    const onPointerCancel = () => {
      resetMarqueeState();
    };

    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("pointercancel", onPointerCancel, true);
    document.addEventListener("visibilitychange", onVisibilityChange);

    const clearSelectionAfterDocChange = () => {
      if (activeRef.current) return;
      if (document.body.classList.contains("quicknote-block-dragging")) return;
      clearSelection();
    };
    editor.on("update", clearSelectionAfterDocChange);

    // 그립 핸들러로 시작한 native drag 도 quicknote-block-dragging body 클래스를 걸어주므로
    // 에디터 영역 dragover 를 명시적으로 수락(브라우저가 moved/drop을 거부 못하도록).
    const onWindowDragOver = (e: DragEvent) => {
      if (!document.body.classList.contains("quicknote-block-dragging")) return;
      const hostRect = editorHost.getBoundingClientRect();
      const insideHost =
        e.clientX >= hostRect.left &&
        e.clientX <= hostRect.right &&
        e.clientY >= hostRect.top &&
        e.clientY <= hostRect.bottom;
      if (!insideHost) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    };
    window.addEventListener("dragover", onWindowDragOver, true);

    const onScrollOrResize = () => {
      if (!editor) return;
      if (activeRef.current) return;
      const positions = selectedStartsRef.current;
      if (positions.length > 0) {
        paintOverlayForPositions(editor, positions);
        return;
      }
      const sel = editor.state.selection;
      if (sel.from === sel.to) {
        hideGroupOverlay(editor);
        return;
      }
      const pmStarts = topLevelBlockStartsInSelectionRange(
        editor.state.doc,
        sel.from,
        sel.to,
      );
      if (pmStarts.length >= 2) {
        paintOverlayForPositions(editor, pmStarts);
      } else {
        hideGroupOverlay(editor);
      }
    };
    const scroller =
      editor.view.dom.closest<HTMLElement>(".overflow-y-auto") ?? window;
    scroller.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize, { passive: true });

    return () => {
      editor.off("update", clearSelectionAfterDocChange);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("pointercancel", onPointerCancel, true);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("selectstart", onSelectStartWhileTracking, true);
      document.body.classList.remove("qn-box-select-dragging");
      document.body.classList.remove("qn-box-select-tracking");
      scroller.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("dragover", onWindowDragOver, true);
      dragRectOverlay.remove();
      hideGroupOverlay(editor);
    };
  }, [
    editor,
    startRef,
    activeRef,
    dragRectRef,
    selectedStartsRef,
    updateSelectionDom,
    clearSelection,
    setSelectedStarts,
  ]);
}
