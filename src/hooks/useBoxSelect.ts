import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { startGripNativeDrag } from "../lib/startBlockNativeDrag";

type Rect = { x: number; y: number; w: number; h: number };

/** nodeDOM이 텍스트/인라인을 줄 때까지 올라가 ProseMirror 직계 자식(최상위 블록 행)만 반환 */
function blockOuterEl(editor: Editor, blockStart: number): HTMLElement | null {
  let n: Node | null = editor.view.nodeDOM(blockStart);
  if (!n) return null;
  if (n.nodeType === Node.TEXT_NODE) n = n.parentElement;
  const root = editor.view.dom;
  let el: HTMLElement | null =
    n instanceof HTMLElement ? n : (n as Node).parentElement;
  while (el && el !== root) {
    if (el.parentElement === root) return el;
    el = el.parentElement;
  }
  return null;
}

/** 문서 직속 블록 목록 (pos = doc.resolve(probe).before(1)) */
function getTopLevelBlocks(editor: Editor): { el: HTMLElement; pos: number }[] {
  const result: { el: HTMLElement; pos: number }[] = [];
  const { doc } = editor.state;
  const innerMax = doc.content.size;
  doc.forEach((node, offset) => {
    if (!node.isBlock) return;
    const probe = Math.min(Math.max(1, offset + 1), innerMax);
    const blockStart = doc.resolve(probe).before(1);
    const el = blockOuterEl(editor, blockStart);
    if (el) result.push({ el, pos: blockStart });
  });
  return result;
}

/**
 * 단일 그룹 오버레이 — 선택된 블록들의 union 바운딩 박스 위에 라운딩된 사각형을 그린다.
 * PM DOM 에는 일절 손대지 않으므로 PM view.update 가 노드를 재렌더해도 영향 없음.
 */
function ensureGroupOverlay(): HTMLDivElement {
  let ov = document.querySelector<HTMLDivElement>("#qn-block-group-overlay");
  if (ov) return ov;
  ov = document.createElement("div");
  ov.id = "qn-block-group-overlay";
  ov.style.cssText = [
    "position: fixed",
    // pointer-events: auto — 오버레이 위에서 mousedown/dragstart 받아 그룹 드래그 핸들로 사용.
    "pointer-events: auto",
    "cursor: grab",
    "z-index: 30",
    "border-radius: 8px",
    "background-color: rgba(35, 131, 226, 0.18)",
    "box-shadow: 0 0 0 2px rgba(35, 131, 226, 0.7)",
    "display: none",
    "transition: none",
  ].join("; ") + ";";
  ov.draggable = true;
  ov.setAttribute("aria-hidden", "true");
  document.body.appendChild(ov);
  return ov;
}

function hideGroupOverlay(): void {
  const ov = document.querySelector<HTMLDivElement>("#qn-block-group-overlay");
  if (ov) ov.style.display = "none";
}

function showGroupOverlayForRects(rects: DOMRect[]): void {
  if (rects.length === 0) {
    hideGroupOverlay();
    return;
  }
  const ov = ensureGroupOverlay();
  let minLeft = Infinity;
  let minTop = Infinity;
  let maxRight = -Infinity;
  let maxBottom = -Infinity;
  rects.forEach((r) => {
    if (r.left < minLeft) minLeft = r.left;
    if (r.top < minTop) minTop = r.top;
    if (r.right > maxRight) maxRight = r.right;
    if (r.bottom > maxBottom) maxBottom = r.bottom;
  });
  // 약간의 여유(블록 라인 위·아래·좌·우 패딩) — 노션 톤
  const PAD = 4;
  ov.style.display = "block";
  ov.style.left = `${minLeft - PAD}px`;
  ov.style.top = `${minTop - PAD}px`;
  ov.style.width = `${maxRight - minLeft + PAD * 2}px`;
  ov.style.height = `${maxBottom - minTop + PAD * 2}px`;
}

/** pos 들을 받아 현재 DOM 좌표로 계산해 그룹 오버레이를 갱신. element 가 detach 되어 있어도
 *  매 호출 fresh 하게 nodeDOM 으로 다시 찾아온다. */
function paintOverlayForPositions(editor: Editor, positions: number[]): void {
  if (positions.length === 0) {
    hideGroupOverlay();
    return;
  }
  const rects: DOMRect[] = [];
  positions.forEach((pos) => {
    const el = blockOuterEl(editor, pos);
    if (el) rects.push(el.getBoundingClientRect());
  });
  showGroupOverlayForRects(rects);
}

export function useBoxSelect(editor: Editor | null) {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [selectedStarts, setSelectedStarts] = useState<number[]>([]);
  const activeRef = useRef(false);
  const dragRectRef = useRef<Rect | null>(null);
  const selectedStartsRef = useRef<number[]>([]);

  const clearSelection = useCallback(() => {
    selectedStartsRef.current = [];
    setSelectedStarts([]);
    hideGroupOverlay();
  }, []);

  const updateSelectionDom = useCallback(
    (rect: Rect) => {
      if (!editor) return;
      // 매 mousemove fresh 한 element 사용. 캐시는 PM 의 view.update 부작용으로 stale 됨.
      const blocks = getTopLevelBlocks(editor);
      const intersectedRects: DOMRect[] = [];
      const newStarts: number[] = [];
      blocks.forEach(({ el, pos }) => {
        const br = el.getBoundingClientRect();
        const intersects =
          br.left < rect.x + rect.w &&
          br.right > rect.x &&
          br.top < rect.y + rect.h &&
          br.bottom > rect.y;
        if (intersects) {
          intersectedRects.push(br);
          newStarts.push(pos);
        }
      });
      selectedStartsRef.current = newStarts;
      showGroupOverlayForRects(intersectedRects);
    },
    [editor],
  );

  useEffect(() => {
    if (!editor) return;
    const columnHost =
      editor.view.dom.closest<HTMLElement>("[data-qn-editor-column]") ??
      editor.view.dom.parentElement;
    // 노션과 동일: 컬럼 좌우의 빈 여백(스크롤 컨테이너)에서도 박스 드래그가 시작되어야 한다.
    const editorHost =
      editor.view.dom.closest<HTMLElement>(".overflow-y-auto") ?? columnHost;
    if (!editorHost) return;

    const dragRectOverlay = document.createElement("div");
    dragRectOverlay.className = "qn-box-select-rect";
    dragRectOverlay.style.display = "none";
    dragRectOverlay.setAttribute("aria-hidden", "true");
    document.body.appendChild(dragRectOverlay);

    const showDragOverlay = (r: Rect) => {
      if (r.w <= 8 || r.h <= 8) {
        dragRectOverlay.style.display = "none";
        return;
      }
      dragRectOverlay.style.display = "block";
      dragRectOverlay.style.left = `${r.x}px`;
      dragRectOverlay.style.top = `${r.y}px`;
      dragRectOverlay.style.width = `${r.w}px`;
      dragRectOverlay.style.height = `${r.h}px`;
    };

    const hideDragOverlay = () => {
      dragRectOverlay.style.display = "none";
    };

    const endMarqueeChrome = () => {
      document.body.classList.remove("qn-box-select-dragging");
    };

    const shouldIgnoreBoxSelectStart = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return true;
      if (!editorHost.contains(target)) return true;
      if (target.closest("input, textarea, select")) return true;
      if (target.closest("[data-qn-block-grip]")) return true;
      // 본문 일반 링크는 클릭 탐색 우선 — 박스 선택 시작 안 함.
      // 연결된 인라인 DB 표 셀은 페이지 링크(<a>)가 많아 여기서 막히면 마퀴가 전혀 안 됨.
      if (
        target.closest("a[href]") &&
        !target.closest(".qn-database-block")
      ) {
        return true;
      }
      if (target.closest("button") && !editor.view.dom.contains(target))
        return true;
      if (target.closest(".tippy-box, [role='menu'], [role='listbox']")) return true;
      return false;
    };

    const onSelectStartWhileTracking = (e: Event) => {
      if (!startRef.current || !activeRef.current) return;
      const t = e.target;
      if (t instanceof Node && editor.view.dom.contains(t)) {
        e.preventDefault();
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      if (shouldIgnoreBoxSelectStart(e.target)) return;
      if (e.button !== 0) return;

      // PM 외부 여백 클릭이면 PM 텍스트 선택 해제(BubbleToolbar 자동 닫힘).
      const target = e.target as Node;
      if (!editor.view.dom.contains(target)) {
        const sel = editor.state.selection;
        if (sel.from !== sel.to) {
          editor.view.dispatch(
            editor.state.tr.setSelection(
              TextSelection.create(editor.state.doc, sel.from),
            ),
          );
        }
      }

      clearSelection();
      startRef.current = { x: e.clientX, y: e.clientY };
      activeRef.current = false;
      document.addEventListener("selectstart", onSelectStartWhileTracking, true);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!startRef.current) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;

      if (!activeRef.current && Math.sqrt(dx * dx + dy * dy) < 8) return;
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

    // capture: DB 블록 등 React 노드뷰에서 onMouseDown stopPropagation 하면 버블이 editorHost 에
    // 도달하지 않아 박스 선택이 시작되지 않음 → 타깃보다 먼저 잡아 마퀴 시작 가능하게 함.
    editorHost.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    // 그룹 오버레이 자체를 드래그 핸들로 사용 — 오버레이를 잡고 끌면 선택된 블록 그룹이 통째로 이동.
    const groupOverlayEl = ensureGroupOverlay();
    const computeActivePositions = (): number[] => {
      // 우선순위: 박스 선택 commit 결과 → PM 텍스트 선택의 다중 블록.
      if (selectedStartsRef.current.length > 0) {
        return [...selectedStartsRef.current];
      }
      const sel = editor.state.selection;
      if (sel.from === sel.to) return [];
      const positions: number[] = [];
      editor.state.doc.forEach((node, offset) => {
        if (!node.isBlock) return;
        const end = offset + node.nodeSize;
        if (end > sel.from && offset < sel.to) positions.push(offset);
      });
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
      // 드래그 중에는 그룹 오버레이를 숨겨 시각 충돌 방지.
      groupOverlayEl.style.display = "none";
      groupOverlayEl.style.cursor = "grabbing";
      startGripNativeDrag(editor, e, firstPos, firstNode, positions);
    };

    const onOverlayDragEnd = () => {
      document.body.classList.remove("quicknote-block-dragging");
      groupOverlayEl.style.cursor = "grab";
      // 드롭 후 — 박스 선택 잔여 정리.
      clearSelection();
    };

    const onOverlayMouseDown = (e: MouseEvent) => {
      // 오버레이 mousedown 이 다른 핸들러로 전파되지 않도록(특히 drag 시작 가능하게).
      e.stopPropagation();
    };

    groupOverlayEl.addEventListener("dragstart", onOverlayDragStart);
    groupOverlayEl.addEventListener("dragend", onOverlayDragEnd);
    groupOverlayEl.addEventListener("mousedown", onOverlayMouseDown);

    // 스크롤·리사이즈 시 그룹 오버레이가 따라오도록 재계산.
    const onScrollOrResize = () => {
      if (!editor) return;
      // 활성 박스 드래그 중에는 mousemove 가 직접 갱신하므로 스킵.
      if (activeRef.current) return;
      const positions = selectedStartsRef.current;
      if (positions.length > 0) {
        paintOverlayForPositions(editor, positions);
        return;
      }
      // PM 다중 선택 → 즉시 재계산
      const sel = editor.state.selection;
      if (sel.from === sel.to) {
        hideGroupOverlay();
        return;
      }
      const pmStarts: number[] = [];
      editor.state.doc.forEach((node, offset) => {
        if (!node.isBlock) return;
        const end = offset + node.nodeSize;
        if (end > sel.from && offset < sel.to) pmStarts.push(offset);
      });
      if (pmStarts.length >= 2) {
        paintOverlayForPositions(editor, pmStarts);
      } else {
        hideGroupOverlay();
      }
    };
    const scroller =
      editor.view.dom.closest<HTMLElement>(".overflow-y-auto") ?? window;
    scroller.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize, { passive: true });

    return () => {
      editorHost.removeEventListener("mousedown", onMouseDown, true);
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
      hideGroupOverlay();
    };
  }, [editor, updateSelectionDom, clearSelection]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedStarts.length > 0) {
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedStarts, clearSelection]);

  // PM 텍스트 선택이 doc 직속 블록 2개 이상을 가로지르면 그룹 오버레이를 그린다.
  // 박스 드래그 활성 중에는 onMouseMove 가 단독 관리하므로 비활성.
  useEffect(() => {
    if (!editor) return;
    let prevPmStarts: number[] = [];

    const arraysEqual = (a: number[], b: number[]) => {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    };

    const apply = () => {
      if (activeRef.current) return;
      const sel = editor.state.selection;
      if (sel.from === sel.to) {
        if (selectedStartsRef.current.length === 0) hideGroupOverlay();
        prevPmStarts = [];
        return;
      }
      const pmStarts: number[] = [];
      editor.state.doc.forEach((node, offset) => {
        if (!node.isBlock) return;
        const end = offset + node.nodeSize;
        if (end > sel.from && offset < sel.to) pmStarts.push(offset);
      });
      if (pmStarts.length < 2) {
        // 단일 블록 내 선택 — 박스 선택이 없으면 오버레이 숨김
        if (selectedStartsRef.current.length === 0) hideGroupOverlay();
        prevPmStarts = [];
        return;
      }
      if (arraysEqual(pmStarts, prevPmStarts)) return;
      prevPmStarts = pmStarts;
      paintOverlayForPositions(editor, pmStarts);
    };

    editor.on("selectionUpdate", apply);
    apply();
    return () => {
      editor.off("selectionUpdate", apply);
    };
  }, [editor]);

  // 박스 선택 commit 후 — 외곽에서 selectedStarts 가 변할 때 오버레이 재계산
  useEffect(() => {
    if (!editor) return;
    if (selectedStarts.length === 0) {
      hideGroupOverlay();
      return;
    }
    paintOverlayForPositions(editor, selectedStarts);
  }, [editor, selectedStarts]);

  useEffect(() => {
    if (!editor || selectedStarts.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      if (selectedStartsRef.current.length === 0) return;
      // 포커스가 편집 영역 안에 있어도, 박스로 잡은 블록이 있으면 여기서 삭제 처리
      // (기존에는 .ProseMirror 포커스 시 조기 return 해서 Delete 가 무시됨)
      e.preventDefault();
      e.stopPropagation();
      const tr = editor.state.tr;
      const sorted = [...selectedStarts].sort((a, b) => b - a);
      for (const pos of sorted) {
        const node = editor.state.doc.nodeAt(pos);
        if (!node) continue;
        if (node.type.name === "databaseBlock" && node.attrs.deletionLocked) {
          continue;
        }
        const mappedPos = tr.mapping.map(pos);
        tr.delete(mappedPos, mappedPos + node.nodeSize);
      }
      editor.view.dispatch(tr.scrollIntoView());
      clearSelection();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editor, selectedStarts, clearSelection]);

  return { selectedStarts, clearSelection };
}
