import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { GripHorizontal, GripVertical, Plus } from "lucide-react";

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

export function TableBlockControls({ editor }: { editor: Editor | null }) {
  const [ui, setUi] = useState<TableUi | null>(null);
  const [drag, setDrag] = useState<{ kind: "row" | "col"; from: number } | null>(null);
  // 클로저 stale 방지 — mousemove 핸들러가 항상 최신 ui를 참조
  const uiRef = useRef<TableUi | null>(null);
  uiRef.current = ui;

  const measureFromTarget = useCallback(
    (target: EventTarget | null) => {
      if (!editor || editor.isDestroyed || !(target instanceof HTMLElement)) return;
      const info = findTableAtElement(editor, target);
      const tableEl = target.closest("table");
      if (!info || !(tableEl instanceof HTMLTableElement)) {
        setUi(null);
        return;
      }
      const firstRow = tableEl.rows.item(0);
      const colRects = firstRow
        ? Array.from(firstRow.cells).map((cell) => cell.getBoundingClientRect())
        : [];
      const rowRects = Array.from(tableEl.rows).map((row) => row.getBoundingClientRect());
      setUi({
        pos: info.pos,
        rect: tableEl.getBoundingClientRect(),
        colRects,
        rowRects,
      });
    },
    [editor],
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const root = editor.view.dom;
    const onMove = (e: MouseEvent) => {
      // SVGElement 등 non-HTMLElement(아이콘 내부 path 등)도 처리
      const rawTarget = e.target;
      if (!(rawTarget instanceof Element)) {
        setUi(null);
        return;
      }
      // "+" 버튼·드래그 핸들은 에디터 밖 fixed 위치 — 테이블 근방이면 ui 유지
      if (!root.contains(rawTarget)) {
        const cur = uiRef.current;
        if (cur) {
          const BUFFER = 56;
          const { rect } = cur;
          const near =
            e.clientX >= rect.left - BUFFER &&
            e.clientX <= rect.right + BUFFER &&
            e.clientY >= rect.top - BUFFER &&
            e.clientY <= rect.bottom + BUFFER;
          if (near) return;
        }
        setUi(null);
        return;
      }
      // SVGElement인 경우 closest로 가장 가까운 HTMLElement를 찾음
      const target = rawTarget instanceof HTMLElement
        ? rawTarget
        : rawTarget.closest<HTMLElement>("td, th, table, [data-type]") ?? rawTarget.closest<HTMLElement>("*");
      measureFromTarget(target);
    };
    const refresh = () => {
      const cur = uiRef.current;
      const table = document.elementFromPoint(
        (cur?.rect.left ?? 0) + 4,
        (cur?.rect.top ?? 0) + 4,
      );
      measureFromTarget(table);
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

  if (!editor || !ui) return null;
  const table = editor.state.doc.nodeAt(ui.pos);
  if (!table || table.type.name !== "table") return null;

  return (
    <div
      data-qn-editor-chrome="table-block-controls"
      className="pointer-events-none fixed inset-0 z-[36]"
    >
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
          draggable
          title="열 드래그 이동"
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            setDrag({ kind: "col", from: index });
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (drag?.kind === "col") reorderTableColumn(editor, ui.pos, table, drag.from, index);
            setDrag(null);
          }}
          className="pointer-events-auto fixed flex h-5 items-center justify-center rounded border border-zinc-200 bg-white px-1 text-zinc-400 shadow-sm hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900"
          style={{ left: rect.left + rect.width / 2 - 12, top: rect.top - 24 }}
        >
          <GripHorizontal size={14} />
        </button>
      ))}
      {ui.rowRects.map((rect, index) => (
        <button
          key={`row-${index}`}
          type="button"
          draggable
          title="행 드래그 이동"
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            setDrag({ kind: "row", from: index });
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (drag?.kind === "row") reorderTableRow(editor, ui.pos, table, drag.from, index);
            setDrag(null);
          }}
          className="pointer-events-auto fixed flex w-5 items-center justify-center rounded border border-zinc-200 bg-white py-1 text-zinc-400 opacity-0 shadow-sm hover:opacity-100 hover:text-zinc-700 focus:opacity-100 dark:border-zinc-700 dark:bg-zinc-900"
          style={{ left: rect.left - 26, top: rect.top + rect.height / 2 - 10 }}
        >
          <GripVertical size={14} />
        </button>
      ))}
    </div>
  );
}
