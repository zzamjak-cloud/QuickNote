import { NodeSelection } from "@tiptap/pm/state";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import type { MutableRefObject } from "react";
import type { insertImageFromFile } from "./insertImageFromFile";
import { insertFileFromFile } from "./insertFileFromFile";
import {
  QUICKNOTE_BLOCK_DRAG_MIME,
} from "../startBlockNativeDrag";
import {
  isTableReorderDragEvent,
  parseTableReorderDragData,
} from "./tableReorderDrag";
import {
  canDropNodeAtInsertionPos,
  resolveBlockDropTarget,
  resolveBlockDropIndicatorRect,
  topLevelInsertionPosFromDrop,
  type BlockDropIndicatorRect,
} from "./blockDropTarget";

export type ColumnDropState = {
  side: "left" | "right";
  targetBlockStart: number;
} | null;

type DraggedBlockShape = {
  insertNode: PMNode;
  listItemNode: PMNode | null;
  sourceListTypeName: string | null;
  deleteFrom: number;
  deleteTo: number;
  deleteWholeParentList: boolean;
};

const LIST_ITEM_TYPES = new Set(["listItem", "taskItem"]);
const LIST_WRAPPER_BY_ITEM: Record<string, string[]> = {
  listItem: ["bulletList", "orderedList"],
  taskItem: ["taskList"],
};

function countProtectedMediaInDoc(doc: import("@tiptap/pm/model").Node): number {
  let count = 0;
  doc.descendants((node) => {
    const isYoutube = node.type.name === "youtube";
    const mime =
      typeof node.attrs?.mime === "string"
        ? node.attrs.mime
        : typeof node.attrs?.mimeType === "string"
          ? node.attrs.mimeType
        : typeof node.attrs?.contentType === "string"
          ? node.attrs.contentType
          : null;
    const isVideoFile =
      node.type.name === "fileBlock" &&
      typeof mime === "string" &&
      mime.startsWith("video/");
    if (isYoutube || isVideoFile) count += 1;
    return true;
  });
  return count;
}

function draggedBlockShape(
  view: EditorView,
  pos: number,
  node: PMNode,
): DraggedBlockShape | null {
  if (!LIST_ITEM_TYPES.has(node.type.name)) {
    return {
      insertNode: node.copy(node.content),
      listItemNode: null,
      sourceListTypeName: null,
      deleteFrom: pos,
      deleteTo: pos + node.nodeSize,
      deleteWholeParentList: false,
    };
  }

  const wrappers = LIST_WRAPPER_BY_ITEM[node.type.name] ?? [];
  try {
    const $pos = view.state.doc.resolve(pos);
    for (let d = $pos.depth - 1; d >= 1; d--) {
      const parent = $pos.node(d);
      if (!wrappers.includes(parent.type.name)) continue;
      const parentStart = $pos.before(d);
      const deleteWholeParentList = parent.childCount <= 1;
      return {
        insertNode: parent.type.create(
          parent.attrs,
          Fragment.from(node.copy(node.content)),
          parent.marks,
        ),
        listItemNode: node.copy(node.content),
        sourceListTypeName: parent.type.name,
        deleteFrom: deleteWholeParentList ? parentStart : pos,
        deleteTo: deleteWholeParentList
          ? parentStart + parent.nodeSize
          : pos + node.nodeSize,
        deleteWholeParentList,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function listItemInsertionPosFromDrop(
  view: EditorView,
  event: DragEvent,
  shape: DraggedBlockShape,
): number | null {
  if (!shape.listItemNode || !shape.sourceListTypeName) return null;
  const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!coords) return null;
  let $pos;
  try {
    $pos = view.state.doc.resolve(coords.pos);
  } catch {
    return null;
  }

  for (let d = $pos.depth; d >= 1; d--) {
    const node = $pos.node(d);
    if (node.type.name !== shape.listItemNode.type.name) continue;
    const parent = $pos.node(d - 1);
    if (parent.type.name !== shape.sourceListTypeName) continue;
    const itemStart = $pos.before(d);
    const dom = view.nodeDOM(itemStart);
    const el = dom instanceof Element ? dom : dom?.parentElement;
    const rect = el?.getBoundingClientRect();
    const after = rect ? event.clientY > rect.top + rect.height / 2 : false;
    return after ? itemStart + node.nodeSize : itemStart;
  }

  for (let d = $pos.depth; d >= 1; d--) {
    const node = $pos.node(d);
    if (node.type.name !== shape.sourceListTypeName) continue;
    const listStart = $pos.before(d);
    return listStart + node.nodeSize - 1;
  }

  return null;
}

function isDropInsideColumn(event: DragEvent): boolean {
  const hit = document.elementFromPoint(event.clientX, event.clientY);
  return Boolean(hit?.closest("[data-column]"));
}

function moveNestedListItemIntoColumn(
  view: EditorView,
  event: DragEvent,
  start: number,
): boolean {
  if (!isDropInsideColumn(event)) return false;
  const node = view.state.doc.nodeAt(start);
  if (!node || !LIST_ITEM_TYPES.has(node.type.name)) return false;
  const shape = draggedBlockShape(view, start, node);
  if (!shape) return false;
  const listInsertAt = listItemInsertionPosFromDrop(view, event, shape);

  const insertAt =
    listInsertAt ??
    topLevelInsertionPosFromDrop(
      view,
      event.clientX,
      event.clientY,
    );
  const insertNode =
    listInsertAt != null && shape.listItemNode
      ? shape.listItemNode
      : shape.insertNode;
  if (!canDropNodeAtInsertionPos(view, insertNode, insertAt)) {
    event.preventDefault();
    return true;
  }
  if (insertAt >= shape.deleteFrom && insertAt <= shape.deleteTo) {
    event.preventDefault();
    return true;
  }

  event.preventDefault();
  const tr = view.state.tr;
  tr.delete(
    tr.mapping.map(shape.deleteFrom),
    tr.mapping.map(shape.deleteTo),
  );
  tr.insert(
    tr.mapping.map(insertAt, -1),
    insertNode,
  );
  const afterMediaCount = countProtectedMediaInDoc(tr.doc);
  const beforeMediaCount = countProtectedMediaInDoc(view.state.doc);
  if (afterMediaCount < beforeMediaCount) return true;
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

function moveSelectedBlockIntoColumn(
  view: EditorView,
  event: DragEvent,
): boolean {
  if (!isDropInsideColumn(event)) return false;
  const sel = view.state.selection;
  if (!(sel instanceof NodeSelection)) return false;
  if (sel.node.type.name === "columnLayout") {
    event.preventDefault();
    return true;
  }
  const shape = draggedBlockShape(view, sel.from, sel.node);
  if (!shape) return false;

  const listInsertAt = listItemInsertionPosFromDrop(view, event, shape);
  const insertAt =
    listInsertAt ??
    topLevelInsertionPosFromDrop(
      view,
      event.clientX,
      event.clientY,
    );
  const insertNode =
    listInsertAt != null && shape.listItemNode
      ? shape.listItemNode
      : shape.insertNode;
  if (!canDropNodeAtInsertionPos(view, insertNode, insertAt)) {
    event.preventDefault();
    return true;
  }
  if (insertAt >= shape.deleteFrom && insertAt <= shape.deleteTo) {
    event.preventDefault();
    return true;
  }

  event.preventDefault();
  const beforeMediaCount = countProtectedMediaInDoc(view.state.doc);
  const tr = view.state.tr;
  tr.delete(
    tr.mapping.map(shape.deleteFrom),
    tr.mapping.map(shape.deleteTo),
  );
  tr.insert(
    tr.mapping.map(insertAt, -1),
    insertNode,
  );
  const afterMediaCount = countProtectedMediaInDoc(tr.doc);
  if (afterMediaCount < beforeMediaCount) return true;
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

function moveSingleQuickNoteBlockFromDrop(
  view: EditorView,
  event: DragEvent,
  start: number,
): boolean {
  const node = view.state.doc.nodeAt(start);
  if (!node || !node.isBlock) return false;
  if (isDropInsideColumn(event) && node.type.name === "columnLayout") {
    event.preventDefault();
    return true;
  }
  const shape = draggedBlockShape(view, start, node);
  if (!shape) return false;
  const listInsertAt = listItemInsertionPosFromDrop(view, event, shape);
  const insertAt =
    listInsertAt ??
    topLevelInsertionPosFromDrop(
      view,
      event.clientX,
      event.clientY,
    );
  const insertNode =
    listInsertAt != null && shape.listItemNode
      ? shape.listItemNode
      : shape.insertNode;
  if (!canDropNodeAtInsertionPos(view, insertNode, insertAt)) {
    event.preventDefault();
    return true;
  }
  if (insertAt >= shape.deleteFrom && insertAt <= shape.deleteTo) {
    event.preventDefault();
    return true;
  }

  event.preventDefault();
  const beforeMediaCount = countProtectedMediaInDoc(view.state.doc);
  const tr = view.state.tr;
  tr.delete(
    tr.mapping.map(shape.deleteFrom),
    tr.mapping.map(shape.deleteTo),
  );
  tr.insert(
    tr.mapping.map(insertAt, -1),
    insertNode,
  );
  const afterMediaCount = countProtectedMediaInDoc(tr.doc);
  if (afterMediaCount < beforeMediaCount) return true;
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

function makeUploadId(): string {
  return `upload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function findFileBlockPosByUploadId(
  view: EditorView,
  uploadId: string,
): number | null {
  let found: number | null = null;
  view.state.doc.descendants((node, pos) => {
    if (
      node.type.name === "fileBlock" &&
      typeof node.attrs.uploadId === "string" &&
      node.attrs.uploadId === uploadId
    ) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

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

function moveQuickNoteBlocksFromDrop(
  view: EditorView,
  event: DragEvent,
  starts: number[],
): boolean {
  const doc = view.state.doc;
  const sorted = [...new Set(starts)].sort((a, b) => a - b);
  if (sorted.length === 1) {
    const movedNestedListItem = moveNestedListItemIntoColumn(
      view,
      event,
      sorted[0]!,
    );
    if (movedNestedListItem) return true;
  }
  const topLevelOnly = sorted.every((pos) => {
    try {
      const $pos = doc.resolve(pos);
      return $pos.depth === 1 && $pos.parent.type.name === "doc";
    } catch {
      return false;
    }
  });
  if (!topLevelOnly && sorted.length === 1) {
    return moveSingleQuickNoteBlockFromDrop(view, event, sorted[0]!);
  }
  if (!topLevelOnly) return false;
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
  if (
    isDropInsideColumn(event) &&
    blocks.some((block) => block.node.type.name === "columnLayout")
  ) {
    event.preventDefault();
    return true;
  }
  const insertAt = topLevelInsertionPosFromDrop(
    view,
    event.clientX,
    event.clientY,
  );
  if (
    blocks.some(
      (block) => !canDropNodeAtInsertionPos(view, block.node, insertAt),
    )
  ) {
    event.preventDefault();
    return true;
  }
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
  clearBlockDropIndicator?: () => void;
  insertImageFromFile: typeof insertImageFromFile;
}) {
  const {
    columnDropRef,
    clearColumnDropUi,
    clearBlockDropIndicator,
    insertImageFromFile,
  } = options;

  return function handleDrop(
    view: EditorView,
    event: DragEvent,
    _slice: unknown,
    moved: boolean,
  ): boolean {
    const draggedStarts = parseQuickNoteBlockDragStarts(event.dataTransfer);
    if (columnDropRef.current) {
      columnDropRef.current = null;
      clearColumnDropUi();
    }
    clearBlockDropIndicator?.();

    if (parseTableReorderDragData(event.dataTransfer)) {
      event.preventDefault?.();
      return true;
    }

    if (moved && moveSelectedBlockIntoColumn(view, event)) {
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
    const coord = view.posAtCoords({
      left: event.clientX,
      top: event.clientY,
    });
    // 모든 dropped file 을 순회:
    // 1) 즉시 임시 fileBlock(업로드중) 삽입으로 시각 피드백 제공
    // 2) 업로드 완료 시 image/file 실제 노드로 교체
    const basePos = coord?.pos ?? view.state.selection.from;
    let insertPos = basePos;
    for (const f of Array.from(files)) {
      const isImage = f.type.startsWith("image/");
      const fileBlockType = view.state.schema.nodes.fileBlock;
      if (!fileBlockType) continue;
      const uploadId = makeUploadId();
      const placeholder = fileBlockType.create({
        name: f.name,
        size: f.size,
        mime: f.type || null,
        uploading: true,
        uploadId,
      });
      view.dispatch(view.state.tr.insert(insertPos, placeholder).scrollIntoView());
      insertPos += placeholder.nodeSize;

      if (isImage) {
        void insertImageFromFile(f, (attrs) => {
          const pos = findFileBlockPosByUploadId(view, uploadId);
          if (pos == null) return;
          const oldNode = view.state.doc.nodeAt(pos);
          if (!oldNode) return;
          const imageNode = view.state.schema.nodes.image?.create(attrs);
          if (!imageNode) return;
          view.dispatch(
            view.state.tr.replaceWith(
              pos,
              pos + oldNode.nodeSize,
              imageNode,
            ),
          );
        }).then((ok) => {
          if (ok) return;
          const pos = findFileBlockPosByUploadId(view, uploadId);
          if (pos == null) return;
          const oldNode = view.state.doc.nodeAt(pos);
          if (!oldNode || oldNode.type.name !== "fileBlock") return;
          view.dispatch(
            view.state.tr.setNodeMarkup(pos, undefined, {
              ...oldNode.attrs,
              uploading: false,
              uploadError: true,
            }),
          );
        });
      } else {
        void insertFileFromFile(f, (attrs) => {
          const pos = findFileBlockPosByUploadId(view, uploadId);
          if (pos == null) return;
          const oldNode = view.state.doc.nodeAt(pos);
          if (!oldNode || oldNode.type.name !== "fileBlock") return;
          view.dispatch(
            view.state.tr.setNodeMarkup(pos, undefined, {
              ...attrs,
              uploading: false,
              uploadId: null,
              uploadError: false,
            }),
          );
        }).then((ok) => {
          if (ok) return;
          const pos = findFileBlockPosByUploadId(view, uploadId);
          if (pos == null) return;
          const oldNode = view.state.doc.nodeAt(pos);
          if (!oldNode || oldNode.type.name !== "fileBlock") return;
          view.dispatch(
            view.state.tr.setNodeMarkup(pos, undefined, {
              ...oldNode.attrs,
              uploading: false,
              uploadError: true,
            }),
          );
        });
      }
    }
    return true;
  };
}

export function createEditorHandleDragOver(options: {
  showBlockDropIndicator: (rect: BlockDropIndicatorRect) => void;
  clearBlockDropIndicator: () => void;
}) {
  const { showBlockDropIndicator, clearBlockDropIndicator } = options;
  return function handleDragOver(view: EditorView, event: DragEvent): boolean {
    if (isTableReorderDragEvent(event.dataTransfer)) {
      clearBlockDropIndicator();
      return false;
    }
    const starts = parseQuickNoteBlockDragStarts(event.dataTransfer);
    if (!starts) return false;
    const nodes = starts
      .map((start) => view.state.doc.nodeAt(start))
      .filter((node): node is PMNode => Boolean(node));
    if (nodes.length === 0) return false;

    const target = resolveBlockDropTarget(
      view,
      event.clientX,
      event.clientY,
      nodes,
    );
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = target.allowed ? "move" : "none";
    }
    if (target.allowed) {
      const rect = resolveBlockDropIndicatorRect(
        view,
        target,
        event.clientX,
        event.clientY,
      );
      if (rect) {
        showBlockDropIndicator(rect);
      } else {
        clearBlockDropIndicator();
      }
      event.preventDefault();
      return true;
    }
    clearBlockDropIndicator();
    event.preventDefault();
    return true;
  };
}

export type { BlockDropIndicatorRect };
