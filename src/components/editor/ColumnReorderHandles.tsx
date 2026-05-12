import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { Plus } from "lucide-react";

type Props = {
  editor: Editor | null;
  boxSelectedStarts?: readonly number[];
};

type HandleItem = {
  index: number;
  start: number;
  colLeft: number;
  colTop: number;
  colWidth: number;
  colHeight: number;
  left: number;
  top: number;
};

type HandleState = {
  layoutStart: number;
  items: HandleItem[];
} | null;

const GEOM_EPS = 0.75;

function handleItemsVisuallyEqual(a: HandleItem[], b: HandleItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const q = b[i]!;
    if (p.index !== q.index || p.start !== q.start) return false;
    if (
      Math.abs(p.colLeft - q.colLeft) >= GEOM_EPS ||
      Math.abs(p.colTop - q.colTop) >= GEOM_EPS ||
      Math.abs(p.colWidth - q.colWidth) >= GEOM_EPS ||
      Math.abs(p.colHeight - q.colHeight) >= GEOM_EPS ||
      Math.abs(p.left - q.left) >= GEOM_EPS ||
      Math.abs(p.top - q.top) >= GEOM_EPS
    ) {
      return false;
    }
  }
  return true;
}

function sameHandleState(
  prev: HandleState,
  next: NonNullable<HandleState>,
): boolean {
  if (prev === null) return false;
  if (prev.layoutStart !== next.layoutStart) return false;
  return handleItemsVisuallyEqual(prev.items, next.items);
}

const clearHandles = (prev: HandleState) => (prev === null ? prev : null);

const DRAG_MIME = "application/x-quicknote-column-reorder";

function parseDragData(dt: DataTransfer | null): { layoutStart: number; fromIndex: number } | null {
  const raw = dt?.getData(DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { layoutStart?: number; fromIndex?: number };
    if (!Number.isInteger(parsed.layoutStart) || !Number.isInteger(parsed.fromIndex)) {
      return null;
    }
    return {
      layoutStart: parsed.layoutStart as number,
      fromIndex: parsed.fromIndex as number,
    };
  } catch {
    return null;
  }
}

export function ColumnReorderHandles({ editor, boxSelectedStarts = [] }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragPayloadRef = useRef<{ layoutStart: number; fromIndex: number } | null>(null);
  const hoveredLayoutElRef = useRef<HTMLElement | null>(null);
  const [handles, setHandles] = useState<HandleState>(null);
  const [dragging, setDragging] = useState(false);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [hoveringLayout, setHoveringLayout] = useState(false);
  const [hoveredColumnIndex, setHoveredColumnIndex] = useState<number | null>(null);
  const [menu, setMenu] = useState<{
    layoutStart: number;
    index: number;
    clientX: number;
    clientY: number;
    deleteArmed: boolean;
  } | null>(null);
  /** 핸들 클릭(메뉴) vs 드래그 구분 — pointerdown~click 동안 이동 여부 추적 */
  const handleSessionRef = useRef<{ moved: boolean } | null>(null);
  const [boxSelecting, setBoxSelecting] = useState(false);
  const [pmRangeSelecting, setPmRangeSelecting] = useState(false);
  const boxSelectionActive = boxSelectedStarts.length > 0 || pmRangeSelecting;

  const getNearestColumnIndexByClientX = useCallback(
    (clientX: number): number | null => {
      if (!handles || handles.items.length === 0) return null;
      const container = containerRef.current;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left;
      let best: { index: number; dist: number } | null = null;
      for (const item of handles.items) {
        const center = item.colLeft + item.colWidth / 2;
        const dist = Math.abs(x - center);
        if (!best || dist < best.dist) best = { index: item.index, dist };
      }
      return best?.index ?? null;
    },
    [handles],
  );

  const refresh = useCallback(() => {
    if (!editor || editor.isDestroyed) {
      setHandles(clearHandles);
      return;
    }
    let editorDom: HTMLElement | null = null;
    try {
      editorDom = editor.view?.dom ?? null;
    } catch {
      setHandles(clearHandles);
      return;
    }
    if (!editorDom) {
      setHandles(clearHandles);
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const { $from } = editor.state.selection;
    let layoutDepth = -1;
    for (let d = $from.depth; d >= 1; d--) {
      if ($from.node(d).type.name === "columnLayout") {
        layoutDepth = d;
        break;
      }
    }
    let layoutStart: number | null = null;
    let layoutNode = layoutDepth >= 0 ? $from.node(layoutDepth) : null;
    if (layoutDepth >= 0) {
      layoutStart = $from.before(layoutDepth);
    } else {
      let hoveredLayoutEl = hoveredLayoutElRef.current;
      // 박스 드래그 중에는 마우스 타깃이 아닌 박스 좌상단 기준으로 레이아웃을 찾는다.
      if (!hoveredLayoutEl) {
        const marquee = document.querySelector(".qn-box-select-rect");
        if (marquee instanceof HTMLElement) {
          const box = marquee.getBoundingClientRect();
          const layouts = Array.from(
            editorDom.querySelectorAll("[data-column-layout]"),
          ).filter((el): el is HTMLElement => el instanceof HTMLElement);
          let best: { el: HTMLElement; area: number } | null = null;
          for (const layout of layouts) {
            const r = layout.getBoundingClientRect();
            const ix = Math.max(0, Math.min(box.right, r.right) - Math.max(box.left, r.left));
            const iy = Math.max(0, Math.min(box.bottom, r.bottom) - Math.max(box.top, r.top));
            const area = ix * iy;
            if (area <= 0) continue;
            if (!best || area > best.area) best = { el: layout, area };
          }
          if (best) {
            hoveredLayoutEl = best.el;
            hoveredLayoutElRef.current = best.el;
          } else {
            // 교차가 없으면 좌상단 probe로 2차 시도
            const probeX = Math.max(0, box.left + 4);
            const probeY = Math.max(0, box.top + 4);
            const hit = document.elementFromPoint(probeX, probeY);
            const layout = hit?.closest?.("[data-column-layout]");
            if (layout instanceof HTMLElement && editorDom.contains(layout)) {
              hoveredLayoutEl = layout;
              hoveredLayoutElRef.current = layout;
            }
          }
        }
      }
      if (!hoveredLayoutEl) {
        // 박스 드래그 중에는 직전 핸들을 유지해 깜빡임/소실을 막는다.
        if (boxSelecting) return;
        setHandles(clearHandles);
        return;
      }
      let pos: number | null = null;
      try {
        pos = editor.view.posAtDOM(hoveredLayoutEl, 0);
      } catch {
        pos = null;
      }
      if (pos == null) {
        setHandles(clearHandles);
        return;
      }
      const $pos = editor.state.doc.resolve(Math.max(0, Math.min(pos, editor.state.doc.content.size)));
      for (let d = $pos.depth; d >= 1; d--) {
        if ($pos.node(d).type.name === "columnLayout") {
          layoutNode = $pos.node(d);
          layoutStart = $pos.before(d);
          break;
        }
      }
      if (!layoutNode || layoutStart == null) {
        setHandles(clearHandles);
        return;
      }
    }
    if (layoutStart == null) {
      setHandles(clearHandles);
      return;
    }
    if (!layoutNode) {
      setHandles(clearHandles);
      return;
    }
    const nextItems: HandleItem[] = [];
    layoutNode.forEach((_col, offset, index) => {
      const colStart = layoutStart + 1 + offset;
      const dom = editor.view.nodeDOM(colStart);
      const el = dom instanceof HTMLElement ? dom : dom?.parentElement;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      nextItems.push({
        index,
        start: colStart,
        colLeft: rect.left - containerRect.left,
        colTop: rect.top - containerRect.top,
        colWidth: rect.width,
        colHeight: rect.height,
        left: rect.left - containerRect.left + rect.width / 2 - 12,
        // 컬럼 박스 상단 경계보다 더 위쪽에 배치
        top: rect.top - containerRect.top - 24,
      });
    });
    if (nextItems.length < 2) {
      setHandles(clearHandles);
      return;
    }
    const nextState: NonNullable<HandleState> = { layoutStart, items: nextItems };
    setHandles((prev) => (sameHandleState(prev, nextState) ? prev : nextState));
  }, [editor, boxSelecting]);

  const reorderColumns = useCallback(
    (layoutStart: number, fromIndex: number, toIndex: number) => {
      if (!editor || editor.isDestroyed) return false;
      const layout = editor.state.doc.nodeAt(layoutStart);
      if (!layout || layout.type.name !== "columnLayout") return false;
      const cols: typeof layout[] = [];
      layout.forEach((col) => cols.push(col));
      if (
        fromIndex < 0 ||
        fromIndex >= cols.length ||
        toIndex < 0 ||
        toIndex >= cols.length ||
        fromIndex === toIndex
      ) {
        return true;
      }
      const moved = cols[fromIndex];
      if (!moved) return false;
      cols.splice(fromIndex, 1);
      cols.splice(toIndex, 0, moved);
      const nextLayout = layout.type.create(
        { ...layout.attrs, columns: cols.length },
        cols,
      );
      const tr = editor.state.tr.replaceWith(
        layoutStart,
        layoutStart + layout.nodeSize,
        nextLayout,
      );
      editor.view.dispatch(tr.scrollIntoView());
      editor.view.focus();
      requestAnimationFrame(refresh);
      return true;
    },
    [editor, refresh],
  );

  const addColumn = useCallback(
    (layoutStart: number) => {
      if (!editor || editor.isDestroyed) return false;
      const layout = editor.state.doc.nodeAt(layoutStart);
      if (!layout || layout.type.name !== "columnLayout") return false;
      if (layout.childCount >= 4) return true;
      const columnType = editor.schema.nodes.column;
      const paragraphType = editor.schema.nodes.paragraph;
      if (!columnType || !paragraphType) return false;
      const cols: PMNode[] = [];
      layout.forEach((col) => cols.push(col));
      cols.push(columnType.create({}, paragraphType.create()));
      const nextLayout = layout.type.create(
        { ...layout.attrs, columns: cols.length },
        Fragment.fromArray(cols),
      );
      const tr = editor.state.tr.replaceWith(
        layoutStart,
        layoutStart + layout.nodeSize,
        nextLayout,
      );
      editor.view.dispatch(tr.scrollIntoView());
      editor.view.focus();
      requestAnimationFrame(refresh);
      return true;
    },
    [editor, refresh],
  );

  const removeColumn = useCallback(
    (layoutStart: number, index: number) => {
      if (!editor || editor.isDestroyed) return false;
      const layout = editor.state.doc.nodeAt(layoutStart);
      if (!layout || layout.type.name !== "columnLayout") return false;
      if (layout.childCount <= 2) return true;
      const columnType = editor.schema.nodes.column;
      if (!columnType) return false;
      const cols: PMNode[] = [];
      layout.forEach((col) => cols.push(col));
      const removed = cols[index];
      if (!removed) return false;
      cols.splice(index, 1);
      if (removed.content.size > 0) {
        const mergeIndex = Math.max(0, Math.min(index - 1, cols.length - 1));
        const target = cols[mergeIndex];
        if (target) {
          const mergedChildren: PMNode[] = [];
          target.forEach((child) => mergedChildren.push(child));
          removed.forEach((child) => mergedChildren.push(child));
          cols[mergeIndex] = columnType.create(
            target.attrs,
            Fragment.fromArray(mergedChildren),
          );
        }
      }
      const nextLayout = layout.type.create(
        { ...layout.attrs, columns: cols.length },
        Fragment.fromArray(cols),
      );
      const tr = editor.state.tr.replaceWith(
        layoutStart,
        layoutStart + layout.nodeSize,
        nextLayout,
      );
      editor.view.dispatch(tr.scrollIntoView());
      editor.view.focus();
      setHoveredColumnIndex(Math.max(0, Math.min(index - 1, cols.length - 1)));
      requestAnimationFrame(refresh);
      return true;
    },
    [editor, refresh],
  );

  /** 컬럼 레이아웃 노드 전체 삭제 */
  const removeColumnLayout = useCallback(
    (layoutStart: number) => {
      if (!editor || editor.isDestroyed) return false;
      const layout = editor.state.doc.nodeAt(layoutStart);
      if (!layout || layout.type.name !== "columnLayout") return false;
      const tr = editor.state.tr.delete(layoutStart, layoutStart + layout.nodeSize);
      editor.view.dispatch(tr.scrollIntoView());
      editor.view.focus();
      requestAnimationFrame(refresh);
      return true;
    },
    [editor, refresh],
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const onAny = () => requestAnimationFrame(refresh);
    let root: HTMLElement | null = null;
    try {
      root = editor.view?.dom ?? null;
    } catch {
      return;
    }
    if (!root) return;
    root.addEventListener("scroll", onAny, { passive: true });
    window.addEventListener("resize", onAny, { passive: true });
    editor.on("selectionUpdate", onAny);
    editor.on("update", onAny);
    refresh();
    return () => {
      root.removeEventListener("scroll", onAny);
      window.removeEventListener("resize", onAny);
      editor.off("selectionUpdate", onAny);
      editor.off("update", onAny);
    };
  }, [editor, refresh]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const sync = () => {
      let root: HTMLElement | null = null;
      try {
        root = editor.view?.dom ?? null;
      } catch {
        setPmRangeSelecting(false);
        return;
      }
      if (!root) {
        setPmRangeSelecting(false);
        return;
      }
      const nextPm =
        !!root.querySelector(".ProseMirror-selectednoderange");
      setPmRangeSelecting((prev) => (prev === nextPm ? prev : nextPm));
    };
    sync();
    editor.on("selectionUpdate", sync);
    editor.on("update", sync);
    return () => {
      editor.off("selectionUpdate", sync);
      editor.off("update", sync);
    };
  }, [editor]);

  useEffect(() => {
    if (!dragging) return;
    document.body.classList.add("quicknote-column-reorder-dragging");
    return () => {
      document.body.classList.remove("quicknote-column-reorder-dragging");
    };
  }, [dragging]);

  useEffect(() => {
    const syncBoxSelecting = () => {
      const cls = document.body.classList;
      const active =
        cls.contains("qn-box-select-tracking") || cls.contains("qn-box-select-dragging");
      setBoxSelecting(active);
    };
    syncBoxSelecting();
    const observer = new MutationObserver(syncBoxSelecting);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const onMove = (e: MouseEvent) => {
      if (editor.isDestroyed) return;
      let editorDom: HTMLElement | null = null;
      try {
        editorDom = editor.view?.dom ?? null;
      } catch {
        return;
      }
      if (!editorDom) return;
      let nextLayoutEl: HTMLElement | null = null;
      const stack = document.elementsFromPoint(e.clientX, e.clientY);
      for (const el of stack) {
        if (!(el instanceof HTMLElement)) continue;
        const layout = el.closest("[data-column-layout]");
        if (layout instanceof HTMLElement && editorDom.contains(layout)) {
          nextLayoutEl = layout;
          break;
        }
      }
      hoveredLayoutElRef.current = nextLayoutEl;

      if (!handles || handles.items.length === 0) {
        setHoveringLayout(!!nextLayoutEl);
        setHoveredColumnIndex(null);
        if (nextLayoutEl) requestAnimationFrame(refresh);
        return;
      }
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const minLeft = Math.min(...handles.items.map((item) => item.colLeft));
      const maxRight = Math.max(...handles.items.map((item) => item.colLeft + item.colWidth));
      const minTop = Math.min(...handles.items.map((item) => item.top));
      const maxBottom = Math.max(...handles.items.map((item) => item.colTop + item.colHeight));
      const controlsBand =
        x >= minLeft - 24 &&
        x <= maxRight + 72 &&
        y >= minTop - 10 &&
        y <= maxBottom;
      const inside =
        !!nextLayoutEl ||
        controlsBand ||
        handles.items.some(
          (item) =>
            x >= item.colLeft &&
            x <= item.colLeft + item.colWidth &&
            y >= item.colTop - 32 &&
            y <= item.colTop + item.colHeight,
        );
      let nextHoveredIndex: number | null = null;
      if (inside) {
        let best: { index: number; distance: number } | null = null;
        for (const item of handles.items) {
          const inColumnX =
            x >= item.colLeft - 8 && x <= item.colLeft + item.colWidth + 8;
          const center = item.colLeft + item.colWidth / 2;
          const distance = inColumnX ? 0 : Math.abs(x - center);
          if (!best || distance < best.distance) {
            best = { index: item.index, distance };
          }
        }
        nextHoveredIndex = best?.index ?? null;
      }
      setHoveringLayout(inside);
      setHoveredColumnIndex(nextHoveredIndex);
      if (nextLayoutEl) requestAnimationFrame(refresh);
    };
    const onLeave = () => {
      hoveredLayoutElRef.current = null;
      setHoveringLayout(false);
      setHoveredColumnIndex(null);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("blur", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("blur", onLeave);
    };
  }, [editor, handles, refresh]);

  useEffect(() => {
    if (!handles) return;
    const onWindowDragOver = (e: DragEvent) => {
      const payload = dragPayloadRef.current;
      if (!payload || payload.layoutStart !== handles.layoutStart) return;
      e.preventDefault();
      const nextIndex = getNearestColumnIndexByClientX(e.clientX);
      if (nextIndex != null && nextIndex !== dropIndex) setDropIndex(nextIndex);
    };
    const onWindowDrop = (e: DragEvent) => {
      const payload = dragPayloadRef.current;
      if (!payload || payload.layoutStart !== handles.layoutStart) return;
      e.preventDefault();
      e.stopPropagation();
      const toIndex = getNearestColumnIndexByClientX(e.clientX) ?? dropIndex;
      setDragging(false);
      setDropIndex(null);
      dragPayloadRef.current = null;
      if (toIndex == null) return;
      reorderColumns(payload.layoutStart, payload.fromIndex, toIndex);
    };
    window.addEventListener("dragover", onWindowDragOver);
    window.addEventListener("drop", onWindowDrop);
    return () => {
      window.removeEventListener("dragover", onWindowDragOver);
      window.removeEventListener("drop", onWindowDrop);
    };
  }, [handles, dropIndex, reorderColumns, getNearestColumnIndexByClientX]);

  // 컬럼 그립 메뉴 외부 클릭/Esc/스크롤로 닫기
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onPointerDownCapture = (ev: PointerEvent) => {
      const el = ev.target;
      if (el instanceof Element && el.closest("[data-qn-column-grip-menu]")) return;
      if (el instanceof Element && el.closest("[data-qn-column-grip]")) return;
      close();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDownCapture, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  const hasRealHandles = !!handles && handles.items.length > 0;
  // 박스 선택 상태에서는 일반 컬럼 hover 핸들을 모두 끄고 단일(좌상단) 핸들만 노출.
  const showColumnHandles =
    hasRealHandles && !boxSelectionActive && (dragging || hoveringLayout || !boxSelecting);
  const activeHandles = showColumnHandles ? handles : null;
  const visibleColumnItems =
    activeHandles
      ? activeHandles.items.filter(
          (item) =>
            dragging ||
            hoveredColumnIndex == null ||
            item.index === hoveredColumnIndex ||
            item.index === dropIndex,
        )
      : [];
  const addButtonItem =
    activeHandles?.items.length
      ? activeHandles.items[
          hoveredColumnIndex == null
            ? activeHandles.items.length - 1
            : Math.min(hoveredColumnIndex, activeHandles.items.length - 1)
        ]
      : null;
  return (
    <div
      ref={containerRef}
      data-qn-editor-chrome="column-reorder-handles"
      className="pointer-events-none absolute inset-0 z-20"
    >
      {dragging && dropIndex != null && handles ? (
        (() => {
          const target = handles.items.find((i) => i.index === dropIndex);
          if (!target) return null;
          return (
            <div
              className="pointer-events-none absolute rounded-lg ring-2 ring-blue-400/75"
              style={{
                left: target.colLeft,
                top: target.colTop,
                width: target.colWidth,
                height: target.colHeight,
              }}
            />
          );
        })()
      ) : null}
      {dragging && handles
        ? handles.items.map((item) => (
            <div
              key={`drop-zone-${item.start}`}
              className="pointer-events-auto absolute"
              style={{
                left: item.colLeft,
                top: item.colTop,
                width: item.colWidth,
                height: item.colHeight,
              }}
              onDragEnter={(e) => {
                const payload = parseDragData(e.dataTransfer);
                if (!payload || payload.layoutStart !== handles.layoutStart) return;
                e.preventDefault();
                setDropIndex(item.index);
              }}
              onDragOver={(e) => {
                const payload = parseDragData(e.dataTransfer);
                if (!payload || payload.layoutStart !== handles.layoutStart) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dropIndex !== item.index) setDropIndex(item.index);
              }}
              onDrop={(e) => {
                const payload = parseDragData(e.dataTransfer);
                if (!payload || payload.layoutStart !== handles.layoutStart) return;
                e.preventDefault();
                e.stopPropagation();
                setDragging(false);
                setDropIndex(null);
                reorderColumns(payload.layoutStart, payload.fromIndex, item.index);
              }}
            />
          ))
        : null}
      {/* 박스 선택 시 별도 컬러 프리셋 핸들은 제거함. 컬러 변경은 BlockHandles 메뉴의 "컬러 변경" 서브메뉴에서 처리한다. */}
      {activeHandles ? visibleColumnItems.map((item) => (
        <div
          key={item.start}
          className="pointer-events-auto absolute flex items-center gap-1"
          style={{ left: item.left, top: item.top }}
        >
          <button
            type="button"
            draggable
            data-qn-column-grip=""
            className={[
              "flex h-6 w-7 cursor-grab items-center justify-center rounded-md border bg-white/95 text-zinc-500 shadow-sm active:cursor-grabbing dark:bg-zinc-900/95 dark:text-zinc-300",
              dropIndex === item.index
                ? "border-blue-500 ring-2 ring-blue-300/70 text-blue-600 dark:border-blue-400 dark:ring-blue-500/40 dark:text-blue-300"
                : "border-zinc-200 hover:bg-zinc-50 hover:text-zinc-800 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
            ].join(" ")}
            title="클릭: 메뉴 · 드래그: 컬럼 순서 변경"
            aria-label={`컬럼 ${item.index + 1} 메뉴/이동`}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              const sx = e.clientX;
              const sy = e.clientY;
              handleSessionRef.current = { moved: false };
              const onMove = (ev: PointerEvent) => {
                const s = handleSessionRef.current;
                if (!s) return;
                if ((ev.clientX - sx) ** 2 + (ev.clientY - sy) ** 2 > 36) s.moved = true;
              };
              const onUp = () => {
                window.removeEventListener("pointermove", onMove);
              };
              window.addEventListener("pointermove", onMove);
              window.addEventListener("pointerup", onUp, { once: true });
            }}
            onDragStart={(e) => {
              if (!handles) return;
              if (handleSessionRef.current) handleSessionRef.current.moved = true;
              e.stopPropagation();
              setDragging(true);
              setDropIndex(item.index);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData(
                DRAG_MIME,
                JSON.stringify({
                  layoutStart: handles.layoutStart,
                  fromIndex: item.index,
                }),
              );
              e.dataTransfer.setData("text/plain", "");
              dragPayloadRef.current = {
                layoutStart: handles.layoutStart,
                fromIndex: item.index,
              };
            }}
            onDragEnd={() => {
              setDragging(false);
              setDropIndex(null);
              dragPayloadRef.current = null;
            }}
            onDragEnter={(e) => {
              if (!parseDragData(e.dataTransfer)) return;
              e.preventDefault();
              setDropIndex(item.index);
            }}
            onDragOver={(e) => {
              if (!parseDragData(e.dataTransfer)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dropIndex !== item.index) setDropIndex(item.index);
            }}
            onDrop={(e) => {
              const payload = parseDragData(e.dataTransfer);
              if (!payload) return;
              e.preventDefault();
              e.stopPropagation();
              setDragging(false);
              setDropIndex(null);
              reorderColumns(payload.layoutStart, payload.fromIndex, item.index);
            }}
            onClick={(e) => {
              const s = handleSessionRef.current;
              handleSessionRef.current = null;
              if (s?.moved) return;
              e.preventDefault();
              e.stopPropagation();
              setMenu({
                layoutStart: activeHandles.layoutStart,
                index: item.index,
                clientX: e.clientX,
                clientY: e.clientY,
                deleteArmed: false,
              });
            }}
          >
            <span className="grid grid-cols-3 gap-0.5">
              {Array.from({ length: 6 }).map((_, idx) => (
                <span
                  key={idx}
                  className="h-0.5 w-0.5 rounded-full bg-current opacity-90"
                />
              ))}
            </span>
          </button>
        </div>
      )) : null}
      {activeHandles && activeHandles.items.length < 4 && addButtonItem ? (
        <button
          type="button"
          onClick={() => addColumn(activeHandles.layoutStart)}
          onMouseEnter={() => {
            setHoveringLayout(true);
            setHoveredColumnIndex(addButtonItem.index);
          }}
          className="pointer-events-auto absolute flex h-6 w-6 items-center justify-center rounded-md border border-zinc-200 bg-white/95 text-zinc-500 shadow-sm hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900/95 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          style={{
            left:
              Math.max(...activeHandles.items.map((item) => item.colLeft + item.colWidth)) + 8,
            top: addButtonItem.top,
          }}
          title="컬럼 추가"
          aria-label="컬럼 추가"
        >
          <Plus size={14} />
        </button>
      ) : null}
      {menu
        ? createPortal(
            <div
              data-qn-column-grip-menu="1"
              role="menu"
              className="pointer-events-auto fixed z-[120] min-w-[11rem] overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-600 dark:bg-zinc-900"
              style={{
                left: Math.min(
                  Math.max(8, menu.clientX - 8),
                  typeof window !== "undefined" ? window.innerWidth - 8 - 208 : menu.clientX,
                ),
                top: Math.min(
                  Math.max(8, menu.clientY - 8),
                  typeof window !== "undefined" ? window.innerHeight - 8 - 120 : menu.clientY,
                ),
              }}
            >
              <div className="px-1 py-1">
                <button
                  type="button"
                  role="menuitem"
                  className={
                    menu.deleteArmed
                      ? "flex w-full items-center rounded px-2 py-1.5 text-left font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                      : "flex w-full items-center rounded px-2 py-1.5 text-left text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  }
                  onClick={() => {
                    if (!menu.deleteArmed) {
                      setMenu((m) => (m ? { ...m, deleteArmed: true } : m));
                      return;
                    }
                    removeColumn(menu.layoutStart, menu.index);
                    setMenu(null);
                  }}
                >
                  {menu.deleteArmed ? "삭제확인" : "열 삭제"}
                </button>
                {!menu.deleteArmed && (
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center rounded px-2 py-1.5 text-left text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    onClick={() => {
                      const ok = window.confirm("컬럼 전체를 삭제하시겠습니까?");
                      if (!ok) return;
                      removeColumnLayout(menu.layoutStart);
                      setMenu(null);
                    }}
                  >
                    컬럼 전체 삭제
                  </button>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
