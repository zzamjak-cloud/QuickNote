import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";

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
  const [boxSelecting, setBoxSelecting] = useState(false);
  const [pmRangeSelecting, setPmRangeSelecting] = useState(false);
  const [boxAnchor, setBoxAnchor] = useState<{ left: number; top: number } | null>(null);
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

  const getFromIndexFromBoxSelection = useCallback((): number | null => {
    if (!handles || boxSelectedStarts.length === 0) return null;
    for (const item of handles.items) {
      const colNode = editor?.state.doc.nodeAt(item.start);
      if (!colNode) continue;
      const colEnd = item.start + colNode.nodeSize;
      const hit = boxSelectedStarts.some((pos) => pos >= item.start && pos < colEnd);
      if (hit) return item.index;
    }
    return handles.items[0]?.index ?? null;
  }, [handles, boxSelectedStarts, editor]);

  const refresh = useCallback(() => {
    if (!editor || editor.isDestroyed) {
      setHandles(null);
      return;
    }
    let editorDom: HTMLElement | null = null;
    try {
      editorDom = editor.view?.dom ?? null;
    } catch {
      setHandles(null);
      return;
    }
    if (!editorDom) {
      setHandles(null);
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
        setHandles(null);
        return;
      }
      let pos: number | null = null;
      try {
        pos = editor.view.posAtDOM(hoveredLayoutEl, 0);
      } catch {
        pos = null;
      }
      if (pos == null) {
        setHandles(null);
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
        setHandles(null);
        return;
      }
    }
    if (layoutStart == null) {
      setHandles(null);
      return;
    }
    if (!layoutNode) {
      setHandles(null);
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
      setHandles(null);
      return;
    }
    setHandles({ layoutStart, items: nextItems });
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
      setPmRangeSelecting(
        !!root.querySelector(".ProseMirror-selectednoderange"),
      );
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
    if (!boxSelectionActive) {
      setBoxAnchor(null);
      return;
    }
    let bestLeft = Number.POSITIVE_INFINITY;
    let bestTop = Number.POSITIVE_INFINITY;
    for (const start of boxSelectedStarts) {
      let dom: Node | null = null;
      try {
        dom = editor.view.nodeDOM(start);
      } catch {
        dom = null;
      }
      const el = dom instanceof HTMLElement ? dom : dom?.parentElement;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.left < bestLeft) bestLeft = r.left;
      if (r.top < bestTop) bestTop = r.top;
    }
    if (Number.isFinite(bestLeft) && Number.isFinite(bestTop)) {
      // 기존 블록 핸들 위치/크기 감각과 맞춘 좌표
      setBoxAnchor({ left: bestLeft - 32, top: bestTop - 2 });
    }
  }, [editor, boxSelectionActive, boxSelectedStarts]);

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
        if (nextLayoutEl) requestAnimationFrame(refresh);
        return;
      }
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const inside = !!nextLayoutEl || handles.items.some(
        (item) =>
          x >= item.colLeft &&
          x <= item.colLeft + item.colWidth &&
          y >= item.colTop - 24 &&
          y <= item.colTop + item.colHeight,
      );
      setHoveringLayout(inside);
      if (nextLayoutEl) requestAnimationFrame(refresh);
    };
    const onLeave = () => {
      hoveredLayoutElRef.current = null;
      setHoveringLayout(false);
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

  const hasRealHandles = !!handles && handles.items.length > 0;
  // 박스 선택 상태에서는 일반 컬럼 hover 핸들을 모두 끄고 단일(좌상단) 핸들만 노출.
  const showColumnHandles =
    hasRealHandles && !boxSelectionActive && (boxSelecting || dragging || hoveringLayout);

  if (boxSelectionActive) return null;

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 z-20">
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
      {boxSelectionActive && boxAnchor ? (
        <button
          type="button"
          draggable
          title="드래그로 컬럼 순서 변경"
          aria-label="선택 컬럼 이동"
          className="pointer-events-auto fixed z-[380] flex h-7 w-7 cursor-grab items-center justify-center rounded-md border border-transparent bg-white/90 text-zinc-500 shadow-sm ring-1 ring-zinc-200/80 hover:bg-zinc-50 hover:text-zinc-800 active:cursor-grabbing dark:bg-zinc-900/90 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          style={{ left: boxAnchor.left, top: boxAnchor.top }}
          onDragStart={(e) => {
            const fromIndex = getFromIndexFromBoxSelection();
            if (fromIndex == null || !handles) return;
            setDragging(true);
            setDropIndex(fromIndex);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", "");
            dragPayloadRef.current = {
              layoutStart: handles.layoutStart,
              fromIndex,
            };
          }}
          onDragEnd={() => {
            setDragging(false);
            setDropIndex(null);
            dragPayloadRef.current = null;
          }}
        >
          <span className="grid grid-cols-3 gap-0.5">
            {Array.from({ length: 6 }).map((_, idx) => (
              <span key={idx} className="h-0.5 w-0.5 rounded-full bg-current opacity-90" />
            ))}
          </span>
        </button>
      ) : null}
      {showColumnHandles && handles?.items.map((item) => (
        <button
          key={item.start}
          type="button"
          draggable
          className={[
            "pointer-events-auto absolute flex h-6 w-7 cursor-grab items-center justify-center rounded-md border bg-white/95 text-zinc-500 shadow-sm active:cursor-grabbing dark:bg-zinc-900/95 dark:text-zinc-300",
            dropIndex === item.index
              ? "border-blue-500 ring-2 ring-blue-300/70 text-blue-600 dark:border-blue-400 dark:ring-blue-500/40 dark:text-blue-300"
              : "border-zinc-200 hover:bg-zinc-50 hover:text-zinc-800 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
          ].join(" ")}
          style={{ left: item.left, top: item.top }}
          title="드래그로 컬럼 순서 변경"
          aria-label={`컬럼 ${item.index + 1} 이동`}
          onDragStart={(e) => {
            if (!handles) return;
            e.stopPropagation();
            setDragging(true);
            setDropIndex(item.index);
            e.dataTransfer.effectAllowed = "move";
            // 브라우저가 본문에 텍스트를 떨어뜨리지 않도록 plain text는 넣지 않는다.
            e.dataTransfer.setData(
              DRAG_MIME,
              JSON.stringify({
                layoutStart: handles.layoutStart,
                fromIndex: item.index,
              }),
            );
            // 일부 브라우저는 text/plain이 없으면 drop 이벤트가 불안정하다.
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
        >
          <span className="grid grid-cols-3 gap-0.5">
            {Array.from({ length: 6 }).map((_, idx) => (
              <span
                // 3x2 점 패턴(가로가 더 넓은 형태)
                key={idx}
                className="h-0.5 w-0.5 rounded-full bg-current opacity-90"
              />
            ))}
          </span>
        </button>
      ))}
    </div>
  );
}
