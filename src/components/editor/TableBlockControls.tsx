import { useCallback, useEffect, useState } from "react";
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
    const onMove = (e: MouseEvent) => measureFromTarget(e.target);
    const refresh = () => {
      const table = document.elementFromPoint(
        (ui?.rect.left ?? 0) + 4,
        (ui?.rect.top ?? 0) + 4,
      );
      measureFromTarget(table);
    };
    root.addEventListener("mousemove", onMove);
    window.addEventListener("scroll", refresh, true);
    window.addEventListener("resize", refresh);
    return () => {
      root.removeEventListener("mousemove", onMove);
      window.removeEventListener("scroll", refresh, true);
      window.removeEventListener("resize", refresh);
    };
  }, [editor, measureFromTarget, ui?.rect.left, ui?.rect.top]);

  if (!editor || !ui) return null;
  const table = editor.state.doc.nodeAt(ui.pos);
  if (!table || table.type.name !== "table") return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[36]">
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
          className="pointer-events-auto fixed flex h-5 items-center justify-center rounded border border-zinc-200 bg-white px-1 text-zinc-400 opacity-0 shadow-sm hover:opacity-100 hover:text-zinc-700 focus:opacity-100 dark:border-zinc-700 dark:bg-zinc-900"
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
