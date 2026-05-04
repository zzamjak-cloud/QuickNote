import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { docTopLevelBlockStart } from "../lib/pm/docTopLevelBlockStart";
import { startGripNativeDrag } from "../lib/startBlockNativeDrag";

type Rect = { x: number; y: number; w: number; h: number };

/** 마퀴를 드래그로 간주하기 전 최소 이동(px). 크면 체감상 꾹 눌러야 하는 느낌이 난다. */
const MARQUEE_ACTIVATE_PX = 4;

const GROUP_OVERLAY_ID = "qn-block-group-overlay";

/** 박스 선택 오버레이를 붙일 호스트 — 스크롤 영역 안에 두어 contains()·히트 테스트가 깨지지 않게 함 */
function getEditorMarqueeHost(editor: Editor): HTMLElement {
  const columnHost =
    editor.view.dom.closest<HTMLElement>("[data-qn-editor-column]") ??
    editor.view.dom.parentElement;
  return (
    editor.view.dom.closest<HTMLElement>(".overflow-y-auto") ??
    columnHost ??
    document.body
  );
}

/** nodeDOM이 텍스트/인라인을 줄 때까지 올라가 ProseMirror 직계 자식(최상위 블록 행)만 반환 */
function blockOuterEl(editor: Editor, blockStart: number): HTMLElement | null {
  const view = editor.view;
  let n: Node | null = view.nodeDOM(blockStart);
  if (!n) {
    const innerMax = view.state.doc.content.size;
    const probe = Math.min(Math.max(1, blockStart + 1), innerMax);
    try {
      const domAt = view.domAtPos(probe);
      n = domAt.node as Node;
      if (n.nodeType === Node.TEXT_NODE) n = n.parentElement;
    } catch {
      return null;
    }
  }
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

/** 문서 직속 블록 목록 */
function getTopLevelBlocks(editor: Editor): { el: HTMLElement; pos: number }[] {
  const result: { el: HTMLElement; pos: number }[] = [];
  const { doc } = editor.state;
  doc.forEach((node, fragmentOffset) => {
    if (!node.isBlock) return;
    const blockStart = docTopLevelBlockStart(fragmentOffset);
    const el = blockOuterEl(editor, blockStart);
    if (el) result.push({ el, pos: blockStart });
  });
  return result;
}

/**
 * 단일 그룹 오버레이 — 선택된 블록들의 union 바운딩 박스 위에 라운딩된 사각형을 그린다.
 * PM DOM 에는 일절 손대지 않으므로 PM view.update 가 노드를 재렌더해도 영향 없음.
 */
function ensureGroupOverlay(editor: Editor): HTMLDivElement {
  const host = getEditorMarqueeHost(editor);
  const misplaced = document.getElementById(GROUP_OVERLAY_ID);
  if (misplaced && misplaced.parentElement !== host) {
    misplaced.remove();
  }
  let ov = host.querySelector<HTMLDivElement>(`#${GROUP_OVERLAY_ID}`);
  if (ov) return ov;
  ov = document.createElement("div");
  ov.id = GROUP_OVERLAY_ID;
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
  host.appendChild(ov);
  return ov;
}

function hideGroupOverlay(editor: Editor | null): void {
  const el = editor
    ? getEditorMarqueeHost(editor).querySelector<HTMLElement>(`#${GROUP_OVERLAY_ID}`)
    : null;
  const ov = el ?? document.getElementById(GROUP_OVERLAY_ID);
  if (ov) ov.style.display = "none";
}

function showGroupOverlayForRects(editor: Editor, rects: DOMRect[]): void {
  if (rects.length === 0) {
    hideGroupOverlay(editor);
    return;
  }
  const ov = ensureGroupOverlay(editor);
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
    hideGroupOverlay(editor);
    return;
  }
  const rects: DOMRect[] = [];
  positions.forEach((pos) => {
    const el = blockOuterEl(editor, pos);
    if (el) rects.push(el.getBoundingClientRect());
  });
  showGroupOverlayForRects(editor, rects);
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
    hideGroupOverlay(editor);
  }, [editor]);

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
      showGroupOverlayForRects(editor, intersectedRects);
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
      // 예전: w<=8 || h<=8 이면 숨김 → 한 축만 움직이면 다른 축이 0이라 사각형이 거의 안 보였음.
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

    const shouldIgnoreBoxSelectStart = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return true;
      if (!editor.view.dom.contains(target)) return true;
      if (!editorHost.contains(target)) return true;
      if (target.closest("[data-qn-block-grip]")) return true;
      // 인라인 DB 블록: 표·여백에서 마퀴 필수 — 입력/버튼만 예외 (select 는 툴바·셀에 많음)
      const inDbBlock = target.closest(".qn-database-block");
      if (inDbBlock) {
        if (target.closest("input, textarea, select")) return true;
        if (target.closest("button")) return true;
        return false;
      }
      if (target.closest("input, textarea, select")) return true;
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

    /** 본문 PM 바깥이지만 스크롤 에디터 안 — 좌우 전체 너비 여백 등. 마퀴 허용하되 페이지 크롬은 제외 */
    const isEditorChromeOutsidePm = (el: Element): boolean =>
      Boolean(
        el.closest(
          [
            "input",
            "textarea",
            "select",
            "button",
            "a[href]",
            "[data-qn-block-grip]",
            ".tippy-box",
            "[role='menu']",
            "[role='listbox']",
            "[role='dialog']",
          ].join(", "),
        ),
      );

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

      // 사이드바·오버레이(body 직결) 등 스크롤 에디터 영역 밖
      if (!editorHost.contains(target)) {
        collapsePmTextSelectionIfNeeded();
        clearSelection();
        return;
      }

      // 그룹 오버레이 — 스크롤 호스트 안에 있으므로 contains 는 통과함. 마퀴는 여기서 시작하지 않고(dragstart 만).
      if (target.closest(`#${GROUP_OVERLAY_ID}`)) {
        return;
      }

      const insidePm = editor.view.dom.contains(target);

      // 한 줄 스크롤 호스트 안·PM 바깥 = 좌우 빈 여백·컬럼 패딩·래퍼 빈 영역 — 전체 너비로 마퀴 시작
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

      // PM 안이지만 마퀴 비대상(링크·버튼·셀 select 등) — 박스 선택만 끊고 드래그 추적은 안 함.
      if (shouldIgnoreBoxSelectStart(target)) {
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

    // capture + window: React 노드뷰·자식에서 stopPropagation 해도 가장 먼저 마퀴 시작 가능.
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    // 그룹 오버레이 자체를 드래그 핸들로 사용 — 오버레이를 잡고 끌면 선택된 블록 그룹이 통째로 이동.
    const groupOverlayEl = ensureGroupOverlay(editor);

    const clearSelectionAfterDocChange = () => {
      if (activeRef.current) return;
      if (document.body.classList.contains("quicknote-block-dragging")) return;
      clearSelection();
    };
    editor.on("update", clearSelectionAfterDocChange);

    const computeActivePositions = (): number[] => {
      // 우선순위: 박스 선택 commit 결과 → PM 텍스트 선택의 다중 블록.
      if (selectedStartsRef.current.length > 0) {
        return [...selectedStartsRef.current];
      }
      const sel = editor.state.selection;
      if (sel.from === sel.to) return [];
      const positions: number[] = [];
      editor.state.doc.forEach((node, fragmentOffset) => {
        if (!node.isBlock) return;
        const start = docTopLevelBlockStart(fragmentOffset);
        const end = start + node.nodeSize;
        if (end > sel.from && start < sel.to) positions.push(start);
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
        hideGroupOverlay(editor);
        return;
      }
      const pmStarts: number[] = [];
      editor.state.doc.forEach((node, fragmentOffset) => {
        if (!node.isBlock) return;
        const start = docTopLevelBlockStart(fragmentOffset);
        const end = start + node.nodeSize;
        if (end > sel.from && start < sel.to) pmStarts.push(start);
      });
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
  }, [editor, updateSelectionDom, clearSelection]);

  useEffect(() => {
    if (!editor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selectedStartsRef.current.length === 0) return;
      clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, clearSelection]);

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
        if (selectedStartsRef.current.length === 0) hideGroupOverlay(editor);
        prevPmStarts = [];
        return;
      }
      const pmStarts: number[] = [];
      editor.state.doc.forEach((node, fragmentOffset) => {
        if (!node.isBlock) return;
        const start = docTopLevelBlockStart(fragmentOffset);
        const end = start + node.nodeSize;
        if (end > sel.from && start < sel.to) pmStarts.push(start);
      });
      if (pmStarts.length < 2) {
        // 단일 블록 내 선택 — 박스 선택이 없으면 오버레이 숨김
        if (selectedStartsRef.current.length === 0) hideGroupOverlay(editor);
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
      hideGroupOverlay(editor);
      return;
    }
    paintOverlayForPositions(editor, selectedStarts);
  }, [editor, selectedStarts]);

  useEffect(() => {
    if (!editor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.key === "Process") return;
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      // selectedStarts state 반영 전에 Delete 가 올 수 있음 — ref 만 신뢰하고 리스너는 항상 등록
      if (selectedStartsRef.current.length === 0) return;
      e.preventDefault();
      e.stopPropagation();

      const doc0 = editor.state.doc;
      const sorted = [...selectedStartsRef.current].sort((a, b) => b - a);
      const tr = editor.state.tr;

      for (const pos of sorted) {
        const node = doc0.nodeAt(pos);
        if (!node) continue;
        if (node.type.name === "databaseBlock" && node.attrs.deletionLocked) {
          continue;
        }
        const mappedPos = tr.mapping.map(pos);
        tr.delete(mappedPos, mappedPos + node.nodeSize);
      }

      if (tr.docChanged) {
        editor.view.dispatch(tr.scrollIntoView());
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editor, clearSelection]);

  return { selectedStarts, clearSelection };
}
