import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { GripHorizontal, GripVertical, Plus } from "lucide-react";
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

/**
 * 첫 행의 셀들을 tableHeader↔tableCell 로 직접 변환한다.
 * TipTap toggleHeaderRow 명령이 셀렉션 위치·확장 등록 상태에 따라 실패할 수 있어 PM 트랜잭션으로 처리.
 */
function applyHeaderRowToggle(editor: Editor, tablePos: number): boolean {
  const state = editor.state;
  const table = state.doc.nodeAt(tablePos);
  if (!table || table.type.name !== "table") return false;
  const firstRow = table.maybeChild(0);
  if (!firstRow) return false;
  const headerType = state.schema.nodes.tableHeader;
  const cellType = state.schema.nodes.tableCell;
  if (!headerType || !cellType) return false;
  const targetType = isHeaderRowActive(table) ? cellType : headerType;
  const newCells: PMNode[] = [];
  firstRow.forEach((cell) => {
    newCells.push(targetType.createChecked(cell.attrs, cell.content, cell.marks));
  });
  const newRow = firstRow.type.createChecked(firstRow.attrs, newCells, firstRow.marks);
  const rowFrom = tablePos + 1; // 테이블 노드 진입 후 첫 자식
  const rowTo = rowFrom + firstRow.nodeSize;
  editor.view.dispatch(state.tr.replaceWith(rowFrom, rowTo, newRow));
  return true;
}

/** 열 삭제: 각 행에서 colIndex 셀을 제거한 새 테이블로 교체 — TipTap deleteColumn 신뢰성 문제 회피. */
function applyDeleteColumn(editor: Editor, tablePos: number, colIndex: number): boolean {
  const state = editor.state;
  const table = state.doc.nodeAt(tablePos);
  if (!table || table.type.name !== "table") return false;
  const firstRow = table.maybeChild(0);
  if (!firstRow) return false;
  if (colIndex < 0 || colIndex >= firstRow.childCount) return false;
  if (firstRow.childCount <= 1) return false; // 마지막 열은 삭제 불가
  const newRows: PMNode[] = [];
  table.forEach((row) => {
    const cells: PMNode[] = [];
    row.forEach((cell, _o, i) => {
      if (i !== colIndex) cells.push(cell);
    });
    newRows.push(row.type.createChecked(row.attrs, cells, row.marks));
  });
  const newTable = table.type.createChecked(table.attrs, newRows, table.marks);
  editor.view.dispatch(state.tr.replaceWith(tablePos, tablePos + table.nodeSize, newTable));
  return true;
}

/** 행 삭제: rowIndex 행만 제거한 새 테이블로 교체. */
function applyDeleteRow(editor: Editor, tablePos: number, rowIndex: number): boolean {
  const state = editor.state;
  const table = state.doc.nodeAt(tablePos);
  if (!table || table.type.name !== "table") return false;
  if (rowIndex < 0 || rowIndex >= table.childCount) return false;
  if (table.childCount <= 1) return false;
  const newRows: PMNode[] = [];
  table.forEach((row, _o, i) => {
    if (i !== rowIndex) newRows.push(row);
  });
  const newTable = table.type.createChecked(table.attrs, newRows, table.marks);
  editor.view.dispatch(state.tr.replaceWith(tablePos, tablePos + table.nodeSize, newTable));
  return true;
}

/** 각 행의 첫 셀을 tableHeader↔tableCell 로 직접 변환 — 테이블 전체 재생성 트랜잭션. */
function applyHeaderColToggle(editor: Editor, tablePos: number): boolean {
  const state = editor.state;
  const table = state.doc.nodeAt(tablePos);
  if (!table || table.type.name !== "table") return false;
  const headerType = state.schema.nodes.tableHeader;
  const cellType = state.schema.nodes.tableCell;
  if (!headerType || !cellType) return false;
  const targetType = isHeaderColActive(table) ? cellType : headerType;
  const newRows: PMNode[] = [];
  table.forEach((row) => {
    const newCells: PMNode[] = [];
    row.forEach((cell, _offset, i) => {
      if (i === 0) {
        newCells.push(targetType.createChecked(cell.attrs, cell.content, cell.marks));
      } else {
        newCells.push(cell);
      }
    });
    newRows.push(row.type.createChecked(row.attrs, newCells, row.marks));
  });
  const newTable = table.type.createChecked(table.attrs, newRows, table.marks);
  editor.view.dispatch(state.tr.replaceWith(tablePos, tablePos + table.nodeSize, newTable));
  return true;
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

  // 표 행/열 드래그: dragstart 즉시 추가되는 body class를 기준으로 모든 dragover를 캡처 허용 —
  // useEffect 지연 없이, MIME 타입 가시성에 의존하지 않음 (일부 브라우저는 dragover에서 custom types를 숨김)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const onDragOver = (e: DragEvent) => {
      if (document.body.classList.contains(TABLE_REORDER_DRAG_BODY_CLASS)) {
        e.preventDefault();
      }
    };
    document.addEventListener("dragover", onDragOver, true);
    return () => document.removeEventListener("dragover", onDragOver, true);
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
            {!gripMenu.deleteArmed && (() => {
              const toggleHeader = (kind: "row" | "col") => {
                if (kind === "row") applyHeaderRowToggle(editor, gripMenu.tablePos);
                else applyHeaderColToggle(editor, gripMenu.tablePos);
                setGripMenu(null);
              };
              return (
                <>
                  {(["row", "col"] as const).map((kind) => {
                    const active = kind === "row" ? headerRowActive : headerColActive;
                    return (
                      <button
                        key={kind}
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center justify-between rounded px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        onClick={() => toggleHeader(kind)}
                      >
                        <span className="text-sm text-zinc-800 dark:text-zinc-200">
                          {kind === "row" ? "헤더행" : "헤더열"}
                        </span>
                        <div
                          className={[
                            "relative inline-flex h-[18px] w-8 flex-shrink-0 items-center rounded-full transition-colors duration-200",
                            active ? "bg-blue-500" : "bg-zinc-200 dark:bg-zinc-600",
                          ].join(" ")}
                        >
                          <span
                            className={[
                              "inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition-transform duration-200",
                              active ? "translate-x-[18px]" : "translate-x-[3px]",
                            ].join(" ")}
                          />
                        </div>
                      </button>
                    );
                  })}
                  <div className="my-1 border-t border-zinc-100 dark:border-zinc-700" />
                </>
              );
            })()}
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
                  applyDeleteColumn(editor, gripMenu.tablePos, gripMenu.index);
                } else {
                  applyDeleteRow(editor, gripMenu.tablePos, gripMenu.index);
                }
                setGripMenu(null);
              }}
            >
              {gripMenu.deleteArmed
                ? "삭제확인"
                : gripMenu.kind === "col"
                  ? "열 삭제"
                  : "행 삭제"}
            </button>
          </div>
        </div>,
        document.body,
      )
    ) : null;

  if (!ui || !table) {
    return <>{gripMenuPortal}</>;
  }

  return (
    <>
      {gripMenuPortal}
      <div
        data-qn-editor-chrome="table-block-controls"
        className="pointer-events-none fixed inset-0 z-[36]"
      >
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
          title="클릭: 메뉴 · 드래그: 열 순서 이동"
          // 열 그립은 HTML5 DnD 대신 포인터 이벤트로 처리 — 테이블 위에 위치한 탓에
          // dragover가 셀에 떨어지면 브라우저가 즉시 드래그를 취소하는 문제를 회피
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const startX = e.clientX;
            const startY = e.clientY;
            const startPos = ui.pos;
            let dragActive = false;

            const onMove = (ev: PointerEvent) => {
              const dist =
                (ev.clientX - startX) ** 2 + (ev.clientY - startY) ** 2;
              if (!dragActive) {
                if (dist > GRIP_DRAG_THRESHOLD_SQ) {
                  dragActive = true;
                  document.body.classList.add(TABLE_REORDER_DRAG_BODY_CLASS);
                  setDrag({ kind: "col", from: index });
                  setDragOverIdx(index);
                }
                return;
              }
              const cur = uiRef.current;
              if (!cur) return;
              const newIdx = resolveHoverColumnIndex(cur, ev.clientX);
              setDragOverIdx((prev) => (prev === newIdx ? prev : newIdx));
            };

            const onUp = (ev: PointerEvent) => {
              window.removeEventListener("pointermove", onMove);
              window.removeEventListener("pointerup", onUp);
              window.removeEventListener("pointercancel", onUp);

              if (dragActive) {
                document.body.classList.remove(TABLE_REORDER_DRAG_BODY_CLASS);
                const cur = uiRef.current;
                if (cur && editor && !editor.isDestroyed) {
                  const toIdx = resolveHoverColumnIndex(cur, ev.clientX);
                  const tableNode = editor.state.doc.nodeAt(cur.pos);
                  if (
                    tableNode?.type.name === "table" &&
                    toIdx !== index
                  ) {
                    reorderTableColumn(
                      editor,
                      cur.pos,
                      tableNode,
                      index,
                      toIdx,
                    );
                  }
                }
                setDrag(null);
                setDragOverIdx(null);
                return;
              }
              // 드래그 미발생 → 메뉴 표시
              setGripMenu({
                kind: "col",
                index,
                tablePos: startPos,
                clientX: ev.clientX,
                clientY: ev.clientY,
                deleteArmed: false,
              });
            };

            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
            window.addEventListener("pointercancel", onUp);
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
