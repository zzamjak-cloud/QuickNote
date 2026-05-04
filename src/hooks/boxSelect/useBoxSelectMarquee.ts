import { type RefObject, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { topLevelBlockStartsInSelectionRange } from "../../lib/pm/topLevelBlocks";
import { startGripNativeDrag } from "../../lib/startBlockNativeDrag";
import { MARQUEE_ACTIVATE_PX } from "./constants";
import type { Rect } from "./types";
import {
  ensureGroupOverlay,
  hideGroupOverlay,
  paintOverlayForPositions,
} from "./overlayDom";
import {
  isEditorChromeOutsidePm,
  isGroupOverlayTarget,
  shouldIgnoreBoxSelectStart,
} from "./hitTest";

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

/** 마퀴 드래그 · 드래그 사각형 오버레이 · 그룹 오버레이 드래그 핸들(window capture 포함) */
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
    if (!editor) return;
    const columnHost =
      editor.view.dom.closest<HTMLElement>("[data-qn-editor-column]") ??
      editor.view.dom.parentElement;
    const editorHost =
      editor.view.dom.closest<HTMLElement>(".overflow-y-auto") ?? columnHost;
    if (!editorHost) return;

    const dragRectOverlay = document.createElement("div");
    dragRectOverlay.className = "qn-box-select-rect";
    dragRectOverlay.style.display = "none";
    dragRectOverlay.setAttribute("aria-hidden", "true");
    document.body.appendChild(dragRectOverlay);

    const showDragOverlay = (r: Rect) => {
      if (Math.max(r.w, r.h) < 1) {
        dragRectOverlay.style.display = "none";
        return;
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

    const endMarqueeChrome = () => {
      document.body.classList.remove("qn-box-select-dragging");
    };

    const onSelectStartWhileTracking = (e: Event) => {
      if (!startRef.current || !activeRef.current) return;
      const t = e.target;
      if (t instanceof Node && editor.view.dom.contains(t)) {
        e.preventDefault();
      }
    };

    const collapsePmTextSelectionIfNeeded = () => {
      const sel = editor.state.selection;
      if (sel.from !== sel.to) {
        editor.view.dispatch(
          editor.state.tr.setSelection(
            TextSelection.create(editor.state.doc, sel.from),
          ),
        );
      }
    };

    const beginMarqueeTracking = (ev: MouseEvent) => {
      clearSelection();
      startRef.current = { x: ev.clientX, y: ev.clientY };
      activeRef.current = false;
      document.addEventListener("selectstart", onSelectStartWhileTracking, true);
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target;
      if (!(target instanceof Element)) return;

      if (!editorHost.contains(target)) {
        collapsePmTextSelectionIfNeeded();
        clearSelection();
        return;
      }

      if (isGroupOverlayTarget(target)) {
        return;
      }

      const insidePm = editor.view.dom.contains(target);

      if (!insidePm) {
        if (isEditorChromeOutsidePm(target)) {
          collapsePmTextSelectionIfNeeded();
          clearSelection();
          return;
        }
        collapsePmTextSelectionIfNeeded();
        beginMarqueeTracking(e);
        return;
      }

      if (shouldIgnoreBoxSelectStart(editor, editorHost, target)) {
        clearSelection();
        return;
      }

      beginMarqueeTracking(e);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!startRef.current) return;
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
        const sel = editor.state.selection;
        if (sel.from !== sel.to) {
          editor.view.dispatch(
            editor.state.tr.setSelection(
              TextSelection.create(editor.state.doc, sel.from),
            ),
          );
        }
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
    };

    const onMouseUp = () => {
      const wasTracking = startRef.current !== null;
      const wasActive = activeRef.current;
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

    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    const groupOverlayEl = ensureGroupOverlay(editor);

    const clearSelectionAfterDocChange = () => {
      if (activeRef.current) return;
      if (document.body.classList.contains("quicknote-block-dragging")) return;
      clearSelection();
    };
    editor.on("update", clearSelectionAfterDocChange);

    const computeActivePositions = (): number[] => {
      if (selectedStartsRef.current.length > 0) {
        return [...selectedStartsRef.current];
      }
      const sel = editor.state.selection;
      if (sel.from === sel.to) return [];
      const positions = topLevelBlockStartsInSelectionRange(
        editor.state.doc,
        sel.from,
        sel.to,
      );
      return positions.length >= 2 ? positions : [];
    };

    const onOverlayDragStart = (e: DragEvent) => {
      const positions = computeActivePositions();
      if (positions.length === 0) {
        e.preventDefault();
        return;
      }
      const sorted = [...positions].sort((a, b) => a - b);
      const firstPos = sorted[0]!;
      const firstNode = editor.state.doc.nodeAt(firstPos);
      if (!firstNode) {
        e.preventDefault();
        return;
      }
      document.body.classList.add("quicknote-block-dragging");
      groupOverlayEl.style.display = "none";
      groupOverlayEl.style.cursor = "grabbing";
      startGripNativeDrag(editor, e, firstPos, firstNode, positions);
    };

    const onOverlayDragEnd = () => {
      document.body.classList.remove("quicknote-block-dragging");
      groupOverlayEl.style.cursor = "grab";
      clearSelection();
    };

    const onOverlayMouseDown = (e: MouseEvent) => {
      e.stopPropagation();
    };

    groupOverlayEl.addEventListener("dragstart", onOverlayDragStart);
    groupOverlayEl.addEventListener("dragend", onOverlayDragEnd);
    groupOverlayEl.addEventListener("mousedown", onOverlayMouseDown);

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
      document.removeEventListener("selectstart", onSelectStartWhileTracking, true);
      document.body.classList.remove("qn-box-select-dragging");
      scroller.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
      groupOverlayEl.removeEventListener("dragstart", onOverlayDragStart);
      groupOverlayEl.removeEventListener("dragend", onOverlayDragEnd);
      groupOverlayEl.removeEventListener("mousedown", onOverlayMouseDown);
      dragRectOverlay.remove();
      hideGroupOverlay(editor);
    };
  }, [editor, updateSelectionDom, clearSelection, setSelectedStarts]);
}
