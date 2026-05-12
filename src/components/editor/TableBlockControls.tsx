import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { AlignCenter, AlignLeft, AlignRight, GripHorizontal, GripVertical, Plus } from "lucide-react";
import {
  setTableReorderDragData,
  TABLE_REORDER_DRAG_BODY_CLASS,
} from "../../lib/editor/tableReorderDrag";

type TableUi = {
  pos: number;
  rect: DOMRect;
  colRects: DOMRect[];
  rowRects: DOMRect[];
};

function findTableAtElement(editor: Editor, el: HTMLElement): { pos: number; node: PMNode } | null {
  const table = el.closest("table");
  if (!(table instanceof HTMLElement) || !editor.view.dom.contains(table)) return null;
  let pos: number;
  try {
    pos = editor.view.posAtDOM(table, 0);
  } catch {
    return null;
  }
  const $pos = editor.state.doc.resolve(Math.max(0, Math.min(pos, editor.state.doc.content.size)));
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === "table") {
      return { pos: depth === 0 ? 0 : $pos.before(depth), node };
    }
  }
  const node = editor.state.doc.nodeAt(pos);
  return node?.type.name === "table" ? { pos, node } : null;
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

function reorderTableRow(editor: Editor, pos: number, table: PMNode, from: number, to: number): void {
  const rows: PMNode[] = [];
  table.forEach((row) => rows.push(row));
  if (!rows[from] || !rows[to]) return;
  const nextRows = moveItem(rows, from, to);
  const nextTable = table.type.createChecked(table.attrs, nextRows, table.marks);
  editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + table.nodeSize, nextTable));
}

function reorderTableColumn(editor: Editor, pos: number, table: PMNode, from: number, to: number): void {
  const nextRows: PMNode[] = [];
  table.forEach((row) => {
    const cells: PMNode[] = [];
    row.forEach((cell) => cells.push(cell));
    if (!cells[from] || !cells[to]) {
      nextRows.push(row);
      return;
    }
    nextRows.push(row.type.createChecked(row.attrs, moveItem(cells, from, to), row.marks));
  });
  const nextTable = table.type.createChecked(table.attrs, nextRows, table.marks);
  editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + table.nodeSize, nextTable));
}

/** 표·행열 핸들·+ 버튼 사이 빈 구간에서도 크롬이 유지되도록 테이블 bbox를 비대칭 확장 */
function isPointerNearTableChrome(rect: DOMRect, clientX: number, clientY: number): boolean {
  const left = rect.left - 64;
  const top = rect.top - 56;
  const right = rect.right + 88;
  const bottom = rect.bottom + 88;
  return clientX >= left && clientX <= right && clientY >= top && clientY <= bottom;
}

/** SVG(path 등)·비 HTML 타깃에서도 표 탐색이 되도록 가장 가까운 HTMLElement */
function resolvePointerTargetElement(raw: EventTarget | null): HTMLElement | null {
  if (!(raw instanceof Element)) return null;
  if (raw instanceof HTMLElement) return raw;
  const byRole = raw.closest<HTMLElement>("td, th, table, tbody, thead, tr, [data-type]");
  if (byRole) return byRole;
  let n: Element | null = raw;
  while (n && !(n instanceof HTMLElement)) n = n.parentElement;
  return n instanceof HTMLElement ? n : null;
}

function measureTableFromElement(tableEl: HTMLTableElement, pos: number): TableUi {
  const firstRow = tableEl.rows.item(0);
  const colRects = firstRow
    ? Array.from(firstRow.cells).map((cell) => cell.getBoundingClientRect())
    : [];
  const rowRects = Array.from(tableEl.rows).map((row) => row.getBoundingClientRect());
  return {
    pos,
    rect: tableEl.getBoundingClientRect(),
    colRects,
    rowRects,
  };
}

/** 드래그 중 포인터 X로 목표 열 인덱스 (셀 경계 밖은 가장 가까운 열) */
function resolveHoverColumnIndex(ui: TableUi, clientX: number): number {
  const { colRects } = ui;
  if (colRects.length === 0) return 0;
  for (let i = 0; i < colRects.length; i += 1) {
    const r = colRects[i]!;
    if (clientX >= r.left && clientX <= r.right) return i;
  }
  if (clientX < colRects[0]!.left) return 0;
  if (clientX > colRects[colRects.length - 1]!.right) return colRects.length - 1;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < colRects.length; i += 1) {
    const r = colRects[i]!;
    const cx = (r.left + r.right) / 2;
    const d = Math.abs(clientX - cx);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** 드래그 중 포인터 Y로 목표 행 인덱스 */
function resolveHoverRowIndex(ui: TableUi, clientY: number): number {
  const { rowRects } = ui;
  if (rowRects.length === 0) return 0;
  for (let i = 0; i < rowRects.length; i += 1) {
    const r = rowRects[i]!;
    if (clientY >= r.top && clientY <= r.bottom) return i;
  }
  if (clientY < rowRects[0]!.top) return 0;
  if (clientY > rowRects[rowRects.length - 1]!.bottom) return rowRects.length - 1;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < rowRects.length; i += 1) {
    const r = rowRects[i]!;
    const cy = (r.top + r.bottom) / 2;
    const d = Math.abs(clientY - cy);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

const GRIP_DRAG_THRESHOLD_SQ = 36; // 6px — 클릭과 드래그 구분

type GripPointerSession = { key: string; moved: boolean };

type GripMenuState = {
  kind: "col" | "row";
  index: number;
  /** 메뉴 열 때 표 노드 위치(ui 사라져도 명령에 사용) */
  tablePos: number;
  clientX: number;
  clientY: number;
  /** 열/행 삭제: false → 첫 클릭 시 확인 단계, true → 다음 클릭에 실제 삭제 */
  deleteArmed: boolean;
};

function getTableElement(editor: Editor, tablePos: number): HTMLTableElement | null {
  const dom = editor.view.nodeDOM(tablePos);
  if (dom instanceof HTMLTableElement) return dom;
  if (dom instanceof HTMLElement) {
    const t = dom.closest("table");
    if (t instanceof HTMLTableElement) return t;
  }
  return null;
}

/** 해당 열의 모든 셀에 텍스트 정렬(align 속성) 적용 */
function setColumnCellAlign(
  editor: Editor,
  tablePos: number,
  colIndex: number,
  align: "left" | "center" | "right",
): void {
  const tableEl = getTableElement(editor, tablePos);
  if (!tableEl) return;
  for (let r = 0; r < tableEl.rows.length; r += 1) {
    const cell = tableEl.rows[r]?.cells[colIndex];
    if (!cell) continue;
    let pos: number;
    try {
      pos = editor.view.posAtDOM(cell, 0);
    } catch {
      continue;
    }
    editor.chain().focus().setTextSelection(pos).setCellAttribute("align", align).run();
  }
}

/** 해당 행의 모든 셀에 텍스트 정렬 적용 */
function setRowCellAlign(
  editor: Editor,
  tablePos: number,
  rowIndex: number,
  align: "left" | "center" | "right",
): void {
  const tableEl = getTableElement(editor, tablePos);
  if (!tableEl) return;
  const row = tableEl.rows[rowIndex];
  if (!row) return;
  for (let c = 0; c < row.cells.length; c += 1) {
    const cell = row.cells[c];
    if (!cell) continue;
    let pos: number;
    try {
      pos = editor.view.posAtDOM(cell, 0);
    } catch {
      continue;
    }
    editor.chain().focus().setTextSelection(pos).setCellAttribute("align", align).run();
  }
}

function focusCellAndDeleteColumn(editor: Editor, tablePos: number, colIndex: number): void {
  const tableEl = getTableElement(editor, tablePos);
  if (!tableEl) return;
  const cell = tableEl.rows[0]?.cells[colIndex];
  if (!cell) return;
  let pos: number;
  try {
    pos = editor.view.posAtDOM(cell, 0);
  } catch {
    return;
  }
  editor.chain().focus().setTextSelection(pos).deleteColumn().run();
}

function focusCellAndDeleteRow(editor: Editor, tablePos: number, rowIndex: number): void {
  const tableEl = getTableElement(editor, tablePos);
  if (!tableEl) return;
  const row = tableEl.rows[rowIndex];
  if (!row?.cells[0]) return;
  const cell = row.cells[0];
  let pos: number;
  try {
    pos = editor.view.posAtDOM(cell, 0);
  } catch {
    return;
  }
  editor.chain().focus().setTextSelection(pos).deleteRow().run();
}

function isHeaderRowActive(table: PMNode): boolean {
  const firstRow = table.maybeChild(0);
  if (!firstRow || firstRow.childCount === 0) return false;
  for (let i = 0; i < firstRow.childCount; i++) {
    if (firstRow.child(i).type.name !== "tableHeader") return false;
  }
  return true;
}

function isHeaderColActive(table: PMNode): boolean {
  if (table.childCount < 2) return false;
  return table.child(1).maybeChild(0)?.type.name === "tableHeader";
}

export function TableBlockControls({ editor }: { editor: Editor | null }) {
  const [ui, setUi] = useState<TableUi | null>(null);
  const [drag, setDrag] = useState<{ kind: "row" | "col"; from: number } | null>(null);
  /** 행·열 순서 드래그 시 드롭될 열/행 인덱스(시각 하이라이트) */
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [hoveredRowIdx, setHoveredRowIdx] = useState<number | null>(null);
  const [hoveredColIdx, setHoveredColIdx] = useState<number | null>(null);
  // 클로저 stale 방지 — mousemove 핸들러가 항상 최신 ui를 참조
  const uiRef = useRef<TableUi | null>(null);
  uiRef.current = ui;
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const [gripMenu, setGripMenu] = useState<GripMenuState | null>(null);
  /** 포인터다운~클릭/드래그시작까지 동안 드래그 의도(이동 임계값 초과) 여부 */
  const gripPointerSessionRef = useRef<GripPointerSession | null>(null);

  const bindGripPointerSession = useCallback((gripKey: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    gripPointerSessionRef.current = { key: gripKey, moved: false };
    const sx = e.clientX;
    const sy = e.clientY;
    const onMove = (ev: PointerEvent) => {
      const s = gripPointerSessionRef.current;
      if (!s || s.key !== gripKey) return;
      if ((ev.clientX - sx) ** 2 + (ev.clientY - sy) ** 2 > GRIP_DRAG_THRESHOLD_SQ) s.moved = true;
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, []);

  /** 열·행 순서 드래그 중 하이라이트 열/행에 정렬 적용 */
  const applyReorderDragAlign = useCallback(
    (align: "left" | "center" | "right") => {
      if (!editor || editor.isDestroyed) return;
      const d = dragRef.current;
      const cur = uiRef.current;
      if (!d || !cur) return;
      const rawIdx = dragOverIdx ?? d.from;
      if (d.kind === "col") {
        const max = cur.colRects.length - 1;
        const idx = Math.max(0, Math.min(rawIdx, max));
        setColumnCellAlign(editor, cur.pos, idx, align);
      } else {
        const max = cur.rowRects.length - 1;
        const idx = Math.max(0, Math.min(rawIdx, max));
        setRowCellAlign(editor, cur.pos, idx, align);
      }
    },
    [editor, dragOverIdx],
  );

  const measureFromTarget = useCallback(
    (target: EventTarget | null, clientX?: number, clientY?: number) => {
      if (!editor || editor.isDestroyed) return;
      // SVG·리사이즈 핸들 등은 HTMLElement가 아님 — 이전과 같이 상태를 건드리지 않음(무조건 clear 금지)
      if (!(target instanceof HTMLElement)) return;
      if (document.body.classList.contains("qn-box-select-dragging")) {
        setUi(null);
        setHoveredRowIdx(null);
        setHoveredColIdx(null);
        return;
      }
      const info = findTableAtElement(editor, target);
      const tableEl = target.closest("table");
      if (!info || !(tableEl instanceof HTMLTableElement)) {
        const cur = uiRef.current;
        const x = clientX;
        const y = clientY;
        if (
          cur &&
          typeof x === "number" &&
          typeof y === "number" &&
          isPointerNearTableChrome(cur.rect, x, y)
        ) {
          const dom = editor.view.nodeDOM(cur.pos);
          const resolved =
            dom instanceof HTMLTableElement
              ? dom
              : dom instanceof HTMLElement
                ? dom.closest("table")
                : null;
          if (resolved instanceof HTMLTableElement) {
            setUi(measureTableFromElement(resolved, cur.pos));
            return;
          }
          // 크롬 구역인데 DOM 재조회 실패 시에도 UI 유지(깜빡임·즉시 소거 방지)
          return;
        }
        setUi(null);
        setHoveredRowIdx(null);
        setHoveredColIdx(null);
        return;
      }
      setUi(measureTableFromElement(tableEl, info.pos));
    },
    [editor],
  );

  useEffect(() => {
    if (!drag) {
      document.body.classList.remove(TABLE_REORDER_DRAG_BODY_CLASS);
      setDragOverIdx(null);
      return;
    }
    // body 클래스는 onDragStart 에서 즉시 추가 — useEffect 이후까지 기다리면 dropcursor 가 1프레임 보일 수 있음

    const onWinDragOver = (e: DragEvent) => {
      const d = dragRef.current;
      if (!d) return;
      e.preventDefault();
      const cur = uiRef.current;
      if (!cur) return;
      const next =
        d.kind === "col"
          ? resolveHoverColumnIndex(cur, e.clientX)
          : resolveHoverRowIndex(cur, e.clientY);
      setDragOverIdx((prev) => (prev === next ? prev : next));
    };

    const onDragEnd = () => {
      gripPointerSessionRef.current = null;
      setDragOverIdx(null);
      setDrag(null);
    };

    // 열 드래그는 그립 버튼이 아닌 테이블 내부로 드롭하는 경우를 처리하기 위해 window 레벨에서 처리
    const onWinDrop = (e: DragEvent) => {
      const d = dragRef.current;
      const cur = uiRef.current;
      if (!d || !cur || !editor || editor.isDestroyed) return;
      e.preventDefault();
      const toIdx =
        d.kind === "col"
          ? resolveHoverColumnIndex(cur, e.clientX)
          : resolveHoverRowIndex(cur, e.clientY);
      const tableNode = editor.state.doc.nodeAt(cur.pos);
      if (!tableNode || tableNode.type.name !== "table") return;
      if (d.kind === "col") reorderTableColumn(editor, cur.pos, tableNode, d.from, toIdx);
      else reorderTableRow(editor, cur.pos, tableNode, d.from, toIdx);
      gripPointerSessionRef.current = null;
      setDrag(null);
      setDragOverIdx(null);
    };

    window.addEventListener("dragover", onWinDragOver);
    window.addEventListener("dragend", onDragEnd);
    window.addEventListener("drop", onWinDrop);
    return () => {
      window.removeEventListener("dragover", onWinDragOver);
      window.removeEventListener("dragend", onDragEnd);
      window.removeEventListener("drop", onWinDrop);
      document.body.classList.remove(TABLE_REORDER_DRAG_BODY_CLASS);
    };
  }, [drag, editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const root = editor.view.dom;
    const onMove = (e: MouseEvent) => {
      // SVGElement 등 non-HTMLElement(아이콘 내부 path 등)도 처리
      const rawTarget = e.target;
      if (!(rawTarget instanceof Element)) {
        setUi(null);
        setHoveredRowIdx(null);
        setHoveredColIdx(null);
        return;
      }
      // "+" 버튼·드래그 핸들은 에디터 밖 fixed 위치 — 테이블 근방이면 ui 유지
      if (!root.contains(rawTarget)) {
        const cur = uiRef.current;
        if (cur && isPointerNearTableChrome(cur.rect, e.clientX, e.clientY)) {
          return;
        }
        setUi(null);
        setHoveredRowIdx(null);
        setHoveredColIdx(null);
        return;
      }
      let target: HTMLElement | null =
        rawTarget instanceof HTMLElement ? rawTarget : resolvePointerTargetElement(rawTarget);
      if (!target) {
        const at = document.elementFromPoint(e.clientX, e.clientY);
        target = resolvePointerTargetElement(at);
      }
      if (!target) return;
      measureFromTarget(target, e.clientX, e.clientY);
      // uiRef.current는 이전 렌더 기준이지만 표 위치는 거의 동일하므로 hover 인덱스 계산에 충분히 정확
      const prevUi = uiRef.current;
      if (prevUi) {
        const rIdx = prevUi.rowRects.findIndex(
          (r) => e.clientY >= r.top && e.clientY <= r.bottom,
        );
        setHoveredRowIdx(rIdx === -1 ? null : rIdx);
        const cIdx = prevUi.colRects.findIndex(
          (r) => e.clientX >= r.left && e.clientX <= r.right,
        );
        setHoveredColIdx(cIdx === -1 ? null : cIdx);
      } else {
        setHoveredRowIdx(null);
        setHoveredColIdx(null);
      }
    };
    const refresh = () => {
      const cur = uiRef.current;
      const x = (cur?.rect.left ?? 0) + 4;
      const y = (cur?.rect.top ?? 0) + 4;
      const el = document.elementFromPoint(x, y);
      const target = resolvePointerTargetElement(el);
      if (target) measureFromTarget(target, x, y);
    };
    // window 전체를 감지해야 "+" 버튼(에디터 외부 fixed)에 접근해도 ui가 유지됨
    window.addEventListener("mousemove", onMove);
    window.addEventListener("scroll", refresh, true);
    window.addEventListener("resize", refresh);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("scroll", refresh, true);
      window.removeEventListener("resize", refresh);
    };
  }, [editor, measureFromTarget]);

  useEffect(() => {
    if (!gripMenu) return;
    const close = () => setGripMenu(null);
    const onPointerDownCapture = (ev: PointerEvent) => {
      const el = ev.target;
      if (el instanceof Element && el.closest("[data-qn-table-grip-menu]")) return;
      if (el instanceof Element && el.closest("[data-qn-table-grip-col], [data-qn-table-grip-row]")) return;
      close();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") close();
    };
    const onScroll = () => close();
    document.addEventListener("pointerdown", onPointerDownCapture, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [gripMenu]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) setGripMenu(null);
  }, [editor]);

  // 표 셀 내부에서 텍스트 선택 드래그 시 부모 스크롤 컨테이너 자동스크롤 방지
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const dom = editor.view.dom;
    const onMouseDown = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      if (!e.target.closest("td, th")) return;
      let scrollEl: HTMLElement | null = null;
      let el: HTMLElement | null = e.target.closest<HTMLElement>("table")?.parentElement ?? null;
      while (el && el !== document.documentElement) {
        const ov = window.getComputedStyle(el).overflowY;
        if (ov === "auto" || ov === "scroll") { scrollEl = el; break; }
        el = el.parentElement;
      }
      if (!scrollEl) return;
      const saved = scrollEl.style.overflowY;
      scrollEl.style.overflowY = "hidden";
      document.addEventListener("mouseup", () => { scrollEl!.style.overflowY = saved; }, { once: true });
    };
    dom.addEventListener("mousedown", onMouseDown);
    return () => dom.removeEventListener("mousedown", onMouseDown);
  }, [editor]);

  if (!editor || editor.isDestroyed) return null;

  const tableAtUi = ui != null ? editor.state.doc.nodeAt(ui.pos) : null;
  const table = tableAtUi?.type.name === "table" ? tableAtUi : null;

  const menuTableForGrip =
    gripMenu != null ? editor.state.doc.nodeAt(gripMenu.tablePos) : null;
  const menuTableValid = menuTableForGrip?.type.name === "table";
  const menuTableNode = menuTableValid && menuTableForGrip ? menuTableForGrip : null;
  const headerRowActive = menuTableNode ? isHeaderRowActive(menuTableNode) : false;
  const headerColActive = menuTableNode ? isHeaderColActive(menuTableNode) : false;

  const dragColRect =
    ui && drag?.kind === "col" && dragOverIdx != null ? (ui.colRects[dragOverIdx] ?? null) : null;
  const dragRowRect =
    ui && drag?.kind === "row" && dragOverIdx != null ? (ui.rowRects[dragOverIdx] ?? null) : null;

  const menuLeft = gripMenu
    ? Math.min(
        Math.max(8, gripMenu.clientX - 8),
        typeof window !== "undefined" ? window.innerWidth - 8 - 208 : gripMenu.clientX,
      )
    : 0;
  const menuTop = gripMenu
    ? Math.min(
        Math.max(8, gripMenu.clientY - 8),
        typeof window !== "undefined" ? window.innerHeight - 8 - 200 : gripMenu.clientY,
      )
    : 0;

  const gripMenuPortal =
    gripMenu && menuTableValid ? (
      createPortal(
        <div
          data-qn-table-grip-menu="1"
          role="menu"
          className="pointer-events-auto fixed z-[120] min-w-[11rem] overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-600 dark:bg-zinc-900"
          style={{ left: menuLeft, top: menuTop }}
        >
          <div className="px-1 py-1">
            {!gripMenu.deleteArmed && (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center rounded px-2 py-1.5 text-left text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                onClick={() => {
                  const tableEl = getTableElement(editor, gripMenu.tablePos);
                  const cell = tableEl?.rows[0]?.cells[0];
                  if (cell) {
                    try {
                      const pos = editor.view.posAtDOM(cell, 0);
                      if (gripMenu.kind === "row") {
                        editor.chain().focus().setTextSelection(pos).toggleHeaderRow().run();
                      } else {
                        editor.chain().focus().setTextSelection(pos).toggleHeaderColumn().run();
                      }
                    } catch { /* 셀 위치 조회 실패 무시 */ }
                  }
                  setGripMenu(null);
                }}
              >
                {gripMenu.kind === "row"
                  ? headerRowActive ? "헤더행 비활성화" : "헤더행 활성화"
                  : headerColActive ? "헤더열 비활성화" : "헤더열 활성화"}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className={
                gripMenu.deleteArmed
                  ? "flex w-full items-center rounded px-2 py-1.5 text-left font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                  : "flex w-full items-center rounded px-2 py-1.5 text-left text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              }
              onClick={() => {
                if (!gripMenu.deleteArmed) {
                  setGripMenu((m) => (m ? { ...m, deleteArmed: true } : m));
                  return;
                }
                if (gripMenu.kind === "col") {
                  focusCellAndDeleteColumn(editor, gripMenu.tablePos, gripMenu.index);
                } else {
                  focusCellAndDeleteRow(editor, gripMenu.tablePos, gripMenu.index);
                }
                setGripMenu(null);
              }}
            >
              {gripMenu.deleteArmed
                ? "삭제 확인 — 다시 클릭하면 삭제됩니다"
                : gripMenu.kind === "col"
                  ? "열 삭제"
                  : "행 삭제"}
            </button>
            {gripMenu.deleteArmed ? (
              <button
                type="button"
                role="menuitem"
                className="mt-0.5 flex w-full items-center rounded px-2 py-1 text-left text-xs text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
                onClick={() => setGripMenu((m) => (m ? { ...m, deleteArmed: false } : m))}
              >
                취소
              </button>
            ) : null}
          </div>
        </div>,
        document.body,
      )
    ) : null;

  if (!ui || !table) {
    return <>{gripMenuPortal}</>;
  }

  const rawDragAlignIdx = drag != null ? (dragOverIdx ?? drag.from) : null;
  const DRAG_ALIGN_TOOLBAR_W = 104;
  const padPx = 8;
  const vwPx = typeof window !== "undefined" ? window.innerWidth : 1200;
  let dragAlignToolbarStyle: CSSProperties | undefined;
  if (drag != null && rawDragAlignIdx != null) {
    const idx =
      drag.kind === "col"
        ? Math.max(0, Math.min(rawDragAlignIdx, ui.colRects.length - 1))
        : Math.max(0, Math.min(rawDragAlignIdx, ui.rowRects.length - 1));
    if (drag.kind === "col" && ui.colRects[idx] != null) {
      const r = ui.colRects[idx]!;
      const left = r.left + r.width / 2 - DRAG_ALIGN_TOOLBAR_W / 2;
      dragAlignToolbarStyle = {
        left: Math.min(Math.max(padPx, left), vwPx - DRAG_ALIGN_TOOLBAR_W - padPx),
        top: Math.max(padPx, ui.rect.top - 44),
      };
    } else if (drag.kind === "row" && ui.rowRects[idx] != null) {
      const r = ui.rowRects[idx]!;
      const left = ui.rect.left + ui.rect.width / 2 - DRAG_ALIGN_TOOLBAR_W / 2;
      dragAlignToolbarStyle = {
        left: Math.min(Math.max(padPx, left), vwPx - DRAG_ALIGN_TOOLBAR_W - padPx),
        top: Math.max(padPx, r.top - 44),
      };
    }
  }

  return (
    <>
      {gripMenuPortal}
      <div
        data-qn-editor-chrome="table-block-controls"
        className="pointer-events-none fixed inset-0 z-[36]"
      >
      {drag != null && dragAlignToolbarStyle != null ? (
        <div
          data-qn-table-reorder-align-toolbar=""
          role="toolbar"
          aria-label="텍스트 정렬"
          className="pointer-events-auto fixed z-[38] flex items-center gap-0.5 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-600 dark:bg-zinc-900"
          style={dragAlignToolbarStyle}
        >
          <button
            type="button"
            title="왼쪽 정렬"
            className="rounded-md p-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            onClick={() => applyReorderDragAlign("left")}
          >
            <AlignLeft className="h-4 w-4" strokeWidth={2} />
          </button>
          <button
            type="button"
            title="가운데 정렬"
            className="rounded-md p-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            onClick={() => applyReorderDragAlign("center")}
          >
            <AlignCenter className="h-4 w-4" strokeWidth={2} />
          </button>
          <button
            type="button"
            title="오른쪽 정렬"
            className="rounded-md p-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            onClick={() => applyReorderDragAlign("right")}
          >
            <AlignRight className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      ) : null}
      {dragColRect ? (
        <div
          aria-hidden
          className="fixed z-[35] rounded-sm border-2 border-blue-500 bg-blue-500/[0.12] shadow-[inset_0_0_0_1px_rgba(59,130,246,0.35)] dark:border-blue-400 dark:bg-blue-400/[0.14] dark:shadow-[inset_0_0_0_1px_rgba(96,165,250,0.45)]"
          style={{
            left: dragColRect.left,
            top: ui.rect.top,
            width: dragColRect.width,
            height: ui.rect.height,
          }}
        />
      ) : null}
      {dragRowRect ? (
        <div
          aria-hidden
          className="fixed z-[35] rounded-sm border-2 border-blue-500 bg-blue-500/[0.12] shadow-[inset_0_0_0_1px_rgba(59,130,246,0.35)] dark:border-blue-400 dark:bg-blue-400/[0.14] dark:shadow-[inset_0_0_0_1px_rgba(96,165,250,0.45)]"
          style={{
            left: ui.rect.left,
            top: dragRowRect.top,
            width: ui.rect.width,
            height: dragRowRect.height,
          }}
        />
      ) : null}
      <button
        type="button"
        title="열 추가"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().addColumnAfter().run()}
        className="pointer-events-auto fixed flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        style={{ left: ui.rect.right + 6, top: ui.rect.top + ui.rect.height / 2 - 12 }}
      >
        <Plus size={13} />
      </button>
      <button
        type="button"
        title="행 추가"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().addRowAfter().run()}
        className="pointer-events-auto fixed flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        style={{ left: ui.rect.left + ui.rect.width / 2 - 12, top: ui.rect.bottom + 6 }}
      >
        <Plus size={13} />
      </button>
      {ui.colRects.map((rect, index) => (
        <button
          key={`col-${index}`}
          type="button"
          data-qn-table-grip-col=""
          draggable
          title="클릭: 메뉴 · 드래그: 열 순서 이동"
          onPointerDown={(e) => bindGripPointerSession(`col:${index}`, e)}
          onDragStart={(e) => {
            // 세션 체크 없이 항상 허용 — dragstart 발화 자체가 이동 의도의 증거
            if (!e.dataTransfer) return;
            const s = gripPointerSessionRef.current;
            if (s?.key === `col:${index}`) s.moved = true;
            document.body.classList.add(TABLE_REORDER_DRAG_BODY_CLASS);
            e.dataTransfer.effectAllowed = "move";
            setTableReorderDragData(e.dataTransfer, {
              kind: "col",
              tablePos: ui.pos,
              from: index,
            });
            setDrag({ kind: "col", from: index });
            setDragOverIdx(index);
          }}
          onClick={(e) => {
            const key = `col:${index}`;
            const s = gripPointerSessionRef.current;
            if (s?.key !== key || s.moved) {
              gripPointerSessionRef.current = null;
              return;
            }
            gripPointerSessionRef.current = null;
            e.preventDefault();
            e.stopPropagation();
            setGripMenu({
              kind: "col",
              index,
              tablePos: ui.pos,
              clientX: e.clientX,
              clientY: e.clientY,
              deleteArmed: false,
            });
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverIdx(index);
          }}
          className={[
            "pointer-events-auto fixed flex h-5 items-center justify-center rounded border border-zinc-200 bg-white px-1 text-zinc-400 shadow-sm hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900",
            "transition-opacity duration-100",
            hoveredColIdx === index ? "opacity-100" : "opacity-0",
          ].join(" ")}
          style={{ left: rect.left + rect.width / 2 - 12, top: rect.top - 24 }}
        >
          <GripHorizontal size={14} />
        </button>
      ))}
      {ui.rowRects.map((rect, index) => (
        <button
          key={`row-${index}`}
          type="button"
          data-qn-table-grip-row=""
          draggable
          title="클릭: 메뉴 · 드래그: 행 순서 이동"
          onPointerDown={(e) => bindGripPointerSession(`row:${index}`, e)}
          onDragStart={(e) => {
            const key = `row:${index}`;
            const s = gripPointerSessionRef.current;
            if (!e.dataTransfer || !s || s.key !== key) {
              e.preventDefault();
              e.stopPropagation();
              if (s?.key === key) gripPointerSessionRef.current = null;
              return;
            }
            // 브라우저가 dragstart 를 발화한 시점 = 이미 이동 의도 확인 — s.moved 강제 설정으로 click 메뉴 방지
            s.moved = true;
            document.body.classList.add(TABLE_REORDER_DRAG_BODY_CLASS);
            e.dataTransfer.effectAllowed = "move";
            setTableReorderDragData(e.dataTransfer, {
              kind: "row",
              tablePos: ui.pos,
              from: index,
            });
            setDrag({ kind: "row", from: index });
            setDragOverIdx(index);
          }}
          onClick={(e) => {
            const key = `row:${index}`;
            const s = gripPointerSessionRef.current;
            if (s?.key !== key || s.moved) {
              gripPointerSessionRef.current = null;
              return;
            }
            gripPointerSessionRef.current = null;
            e.preventDefault();
            e.stopPropagation();
            setGripMenu({
              kind: "row",
              index,
              tablePos: ui.pos,
              clientX: e.clientX,
              clientY: e.clientY,
              deleteArmed: false,
            });
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverIdx(index);
          }}
          className={[
            "pointer-events-auto fixed flex w-5 items-center justify-center rounded border border-zinc-200 bg-white py-1 text-zinc-400 shadow-sm hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900",
            "transition-opacity duration-100",
            hoveredRowIdx === index ? "opacity-100" : "opacity-0",
          ].join(" ")}
          style={{ left: rect.left - 26, top: rect.top + rect.height / 2 - 10 }}
        >
          <GripVertical size={14} />
        </button>
      ))}
    </div>
    </>
  );
}
