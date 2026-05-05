import { NodeSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { MutableRefObject } from "react";
import type { insertImageFromFile } from "./insertImageFromFile";
import {
  QUICKNOTE_BLOCK_DRAG_MIME,
} from "../startBlockNativeDrag";
import { forEachDocDirectBlock } from "../pm/topLevelBlocks";

export type ColumnDropState = {
  side: "left" | "right";
  targetBlockStart: number;
} | null;

function parseQuickNoteBlockDragStarts(dt: DataTransfer | null): number[] | null {
  const raw = dt?.getData(QUICKNOTE_BLOCK_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const starts = parsed.filter(
      (v): v is number => Number.isInteger(v) && v >= 0,
    );
    return starts.length > 0 ? starts : null;
  } catch {
    return null;
  }
}

/** doc 직속 자식의 화면 rect 를 모아 Y 좌표 기준 가장 가까운 블록을 찾아 삽입 위치 반환.
 *  posAtCoords 가 null 이거나 atom databaseBlock 위라 depth 0 으로 도달한 경우의 최종 폴백. */
function nearestTopLevelInsertionByY(
  view: EditorView,
  clientY: number,
): number {
  let bestStart: number | null = null;
  let bestEnd: number | null = null;
  let bestDistance = Infinity;
  let bestAfter = false;
  forEachDocDirectBlock(view.state.doc, (node, blockStart) => {
    const dom = view.nodeDOM(blockStart);
    const el = dom instanceof Element ? dom : dom?.parentElement;
    const rectEl =
      el instanceof Element
        ? el.closest(".qn-database-block") ?? el
        : null;
    const rect = (rectEl instanceof HTMLElement ? rectEl : el)?.getBoundingClientRect();
    if (!rect) return;
    let distance: number;
    let after: boolean;
    if (clientY < rect.top) {
      distance = rect.top - clientY;
      after = false;
    } else if (clientY > rect.bottom) {
      distance = clientY - rect.bottom;
      after = true;
    } else {
      distance = 0;
      after = clientY > rect.top + rect.height / 2;
    }
    if (distance < bestDistance) {
      bestDistance = distance;
      bestStart = blockStart;
      bestEnd = blockStart + node.nodeSize;
      bestAfter = after;
    }
  });
  if (bestStart == null || bestEnd == null) return view.state.doc.content.size;
  return bestAfter ? bestEnd : bestStart;
}

function topLevelInsertionPosFromDrop(
  view: EditorView,
  clientX: number,
  clientY: number,
): number {
  const coords = view.posAtCoords({ left: clientX, top: clientY });
  if (!coords) return nearestTopLevelInsertionByY(view, clientY);

  let $pos;
  try {
    $pos = view.state.doc.resolve(coords.pos);
  } catch {
    return nearestTopLevelInsertionByY(view, clientY);
  }

  for (let d = $pos.depth; d >= 1; d--) {
    const node = $pos.node(d);
    if (!node.isBlock || node.type.name === "doc") continue;
    if (d !== 1 && $pos.node(d - 1).type.name !== "doc") continue;
    const targetStart = $pos.before(d);
    const dom = view.nodeDOM(targetStart);
    const el = dom instanceof Element ? dom : dom?.parentElement;
    const rectEl =
      el instanceof Element
        ? el.closest(".qn-database-block") ?? el
        : null;
    const rect = (rectEl instanceof HTMLElement ? rectEl : el)?.getBoundingClientRect();
    const after = rect ? clientY > rect.top + rect.height / 2 : false;
    return after ? targetStart + node.nodeSize : targetStart;
  }

  // depth 0 — atom databaseBlock 또는 doc padding 영역(.ProseMirror 자체).
  // 좌표 기반으로 가장 가까운 doc 직속 블록을 찾아 삽입 위치 결정.
  return nearestTopLevelInsertionByY(view, clientY);
}

function moveQuickNoteBlocksFromDrop(
  view: EditorView,
  event: DragEvent,
  starts: number[],
): boolean {
  const doc = view.state.doc;
  const sorted = [...new Set(starts)].sort((a, b) => a - b);
  const blocks = sorted
    .map((pos) => {
      const node = doc.nodeAt(pos);
      if (!node || !node.isBlock) return null;
      return { pos, node, end: pos + node.nodeSize };
    })
    .filter((v): v is { pos: number; node: import("@tiptap/pm/model").Node; end: number } => v != null);

  if (blocks.length === 0) {
    return false;
  }
  const insertAt = topLevelInsertionPosFromDrop(
    view,
    event.clientX,
    event.clientY,
  );
  // 삽입점이 선택 블록 중 하나 "안"이면 no-op.
  if (blocks.some((b) => insertAt >= b.pos && insertAt <= b.end)) {
    event.preventDefault();
    return true;
  }

  event.preventDefault();
  const tr = view.state.tr;
  // 뒤에서부터 삭제해 pos 안정성 보장
  [...blocks]
    .sort((a, b) => b.pos - a.pos)
    .forEach((b) => {
      tr.delete(tr.mapping.map(b.pos), tr.mapping.map(b.end));
    });
  let mappedInsertAt = tr.mapping.map(insertAt, 1);
  for (const b of blocks) {
    tr.insert(mappedInsertAt, b.node.copy(b.node.content));
    mappedInsertAt += b.node.nodeSize;
  }
  view.dispatch(tr.scrollIntoView());
  // 드롭 직후 PM 으로 포커스 복귀 — Ctrl+Z(undo) 단축키가 PM keymap 에 도달하도록.
  view.focus();
  return true;
}

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
    const draggedStarts = parseQuickNoteBlockDragStarts(event.dataTransfer);
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
        view.focus();
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
      view.focus();
      return true;
    }

    // 오버레이(div)에서 시작한 drag 는 브라우저에 따라 moved=false 로 들어올 수 있다.
    // QUICKNOTE_BLOCK_DRAG_MIME 이 있으면 moved 값과 무관하게 블록 이동 경로로 처리.
    if (draggedStarts) {
      return moveQuickNoteBlocksFromDrop(view, event, draggedStarts);
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
