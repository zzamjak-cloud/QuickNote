import { NodeSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { MutableRefObject } from "react";
import type { insertImageFromFile } from "./insertImageFromFile";

export type ColumnDropState = {
  side: "left" | "right";
  targetBlockStart: number;
} | null;

export function createEditorHandleDrop(options: {
  columnDropRef: MutableRefObject<ColumnDropState>;
  clearColumnDropUi: () => void;
  insertImageFromFile: typeof insertImageFromFile;
}) {
  const { columnDropRef, clearColumnDropUi, insertImageFromFile } = options;

  return function handleDrop(
    view: EditorView,
    event: DragEvent,
    _slice: unknown,
    moved: boolean,
  ): boolean {
    if (moved && columnDropRef.current) {
      const { side, targetBlockStart } = columnDropRef.current;
      columnDropRef.current = null;
      clearColumnDropUi();

      const sel = view.state.selection;
      if (!(sel instanceof NodeSelection)) return false;

      const draggedStart = sel.from;
      const draggedNode = sel.node;
      const targetNode = view.state.doc.nodeAt(targetBlockStart);
      if (!targetNode || draggedStart === targetBlockStart) return false;

      const { schema } = view.state;
      if (!schema.nodes.column || !schema.nodes.columnLayout) return false;

      event.preventDefault();

      const pos1 = Math.min(draggedStart, targetBlockStart);
      const pos2 = Math.max(draggedStart, targetBlockStart);
      const node1 = view.state.doc.nodeAt(pos1)!;
      const node2 = view.state.doc.nodeAt(pos2)!;

      if (targetNode.type.name === "columnLayout") {
        const existingCols: import("@tiptap/pm/model").Node[] = [];
        targetNode.content.forEach((col) => existingCols.push(col));
        if (existingCols.length >= 4) return false;
        const newCol = schema.nodes.column.create(
          {},
          draggedNode.copy(draggedNode.content),
        );
        const newCols =
          side === "right"
            ? [...existingCols, newCol]
            : [newCol, ...existingCols];
        const newLayout = schema.nodes.columnLayout.create(
          { columns: newCols.length },
          newCols,
        );
        const tr = view.state.tr;
        tr.delete(pos2, pos2 + node2.nodeSize);
        tr.delete(pos1, pos1 + node1.nodeSize);
        tr.insert(pos1, newLayout);
        view.dispatch(tr.scrollIntoView());
        return true;
      }

      const leftNode =
        side === "left"
          ? draggedStart < targetBlockStart
            ? draggedNode
            : targetNode
          : draggedStart < targetBlockStart
            ? targetNode
            : draggedNode;
      const rightNode =
        side === "left"
          ? draggedStart < targetBlockStart
            ? targetNode
            : draggedNode
          : draggedStart < targetBlockStart
            ? draggedNode
            : targetNode;

      const col1 = schema.nodes.column.create({}, leftNode.copy(leftNode.content));
      const col2 = schema.nodes.column.create(
        {},
        rightNode.copy(rightNode.content),
      );
      const layout = schema.nodes.columnLayout.create({ columns: 2 }, [col1, col2]);

      const tr = view.state.tr;
      tr.delete(pos2, pos2 + node2.nodeSize);
      tr.delete(pos1, pos1 + node1.nodeSize);
      tr.insert(pos1, layout);
      view.dispatch(tr.scrollIntoView());
      return true;
    }

    if (moved) return false;
    event.preventDefault?.();
    const dt = event.dataTransfer;
    const files = dt?.files;
    if (!files || files.length === 0) return false;
    const imgFile = Array.from(files).find((f) => f.type.startsWith("image/"));
    if (!imgFile) return false;
    const coord = view.posAtCoords({
      left: event.clientX,
      top: event.clientY,
    });
    void insertImageFromFile(imgFile, (attrs) => {
      const tr = view.state.tr;
      const node = view.state.schema.nodes.image!.create(attrs);
      if (coord) {
        tr.insert(coord.pos, node);
      } else {
        tr.replaceSelectionWith(node);
      }
      view.dispatch(tr.scrollIntoView());
    });
    return true;
  };
}
