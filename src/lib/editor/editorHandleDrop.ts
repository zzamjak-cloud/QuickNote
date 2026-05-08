import { NodeSelection } from "@tiptap/pm/state";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import type { MutableRefObject } from "react";
import type { insertImageFromFile } from "./insertImageFromFile";
import { insertFileFromFile } from "./insertFileFromFile";
import {
  QUICKNOTE_BLOCK_DRAG_MIME,
} from "../startBlockNativeDrag";
import { queryTabPanelElements } from "../tiptapExtensions/tabPanelDom";
import { forEachDocDirectBlock } from "../pm/topLevelBlocks";

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

/** 빈 패널 영역 드롭 시 활성 탭의 패널 DOM 을 택한다 */
function resolveTabPanelElementFromPoint(
  view: EditorView,
  clientX: number,
  clientY: number,
): HTMLElement | null {
  const hit = document.elementFromPoint(clientX, clientY);
  if (!hit || !view.dom.contains(hit)) return null;
  const direct = hit.closest("[data-tab-panel]");
  if (direct instanceof HTMLElement) return direct;
  const panelsRoot = hit.closest(".qn-tab-panels");
  const tabBlock = hit.closest("[data-tab-block]");
  if (!(panelsRoot instanceof HTMLElement) || !(tabBlock instanceof HTMLElement)) {
    return null;
  }
  const rawIdx = Number(tabBlock.getAttribute("data-active-index") ?? "0");
  const idx = Number.isFinite(rawIdx) ? Math.max(0, rawIdx) : 0;
  const panels = queryTabPanelElements(panelsRoot);
  const panel = panels[idx];
  return panel ?? null;
}

function tabPanelInsertionPosFromPoint(
  view: EditorView,
  clientX: number,
  clientY: number,
): number | null {
  const panelEl = resolveTabPanelElementFromPoint(view, clientX, clientY);
  if (!panelEl) return null;

  let panelStart: number | null = null;
  let panelNode: PMNode | null = null;
  try {
    const rawPos = view.posAtDOM(panelEl, 0);
    const $raw = view.state.doc.resolve(
      Math.max(0, Math.min(rawPos, view.state.doc.content.size)),
    );
    for (let d = $raw.depth; d >= 1; d--) {
      if ($raw.node(d).type.name !== "tabPanel") continue;
      panelStart = $raw.before(d);
      panelNode = $raw.node(d);
      break;
    }
    if (panelStart == null) {
      const maybeNode = view.state.doc.nodeAt(rawPos);
      if (maybeNode?.type.name === "tabPanel") {
        panelStart = rawPos;
        panelNode = maybeNode;
      }
    }
  } catch {
    return null;
  }
  if (panelStart == null || !panelNode || panelNode.type.name !== "tabPanel") {
    return null;
  }

  let fallback = panelStart + panelNode.nodeSize - 1;
  let bestPos: number | null = null;
  let bestDistance = Infinity;
  panelNode.forEach((child, offset) => {
    const childStart = panelStart! + 1 + offset;
    const dom = view.nodeDOM(childStart);
    const el = dom instanceof Element ? dom : dom?.parentElement;
    const rectEl =
      el instanceof Element ? el.closest(".qn-database-block") ?? el : null;
    const rect = (rectEl instanceof HTMLElement ? rectEl : el)?.getBoundingClientRect();
    if (!rect) return;
    const after = clientY > rect.top + rect.height / 2;
    const distance =
      clientY < rect.top
        ? rect.top - clientY
        : clientY > rect.bottom
          ? clientY - rect.bottom
          : 0;
    const pos = after ? childStart + child.nodeSize : childStart;
    if (distance < bestDistance) {
      bestPos = pos;
      bestDistance = distance;
    }
    fallback = childStart + child.nodeSize;
  });

  return bestPos ?? fallback;
}

function columnInsertionPosFromPoint(
  view: EditorView,
  clientX: number,
  clientY: number,
): number | null {
  const hit = document.elementFromPoint(clientX, clientY);
  const colEl = hit?.closest?.("[data-column]");
  if (!(colEl instanceof HTMLElement) || !view.dom.contains(colEl)) return null;

  let colStart: number | null = null;
  let colNode: PMNode | null = null;
  try {
    const rawPos = view.posAtDOM(colEl, 0);
    const $raw = view.state.doc.resolve(
      Math.max(0, Math.min(rawPos, view.state.doc.content.size)),
    );
    for (let d = $raw.depth; d >= 1; d--) {
      if ($raw.node(d).type.name !== "column") continue;
      colStart = $raw.before(d);
      colNode = $raw.node(d);
      break;
    }
    if (colStart == null) {
      const maybeNode = view.state.doc.nodeAt(rawPos);
      if (maybeNode?.type.name === "column") {
        colStart = rawPos;
        colNode = maybeNode;
      }
    }
  } catch {
    colStart = null;
    colNode = null;
  }
  if (colStart == null || !colNode || colNode.type.name !== "column") return null;

  let fallback = colStart + colNode.nodeSize - 1;
  let bestPos: number | null = null;
  let bestDistance = Infinity;
  colNode.forEach((child, offset) => {
    const childStart = colStart + 1 + offset;
    const dom = view.nodeDOM(childStart);
    const el = dom instanceof Element ? dom : dom?.parentElement;
    const rectEl =
      el instanceof Element
        ? el.closest(".qn-database-block") ?? el
        : null;
    const rect = (rectEl instanceof HTMLElement ? rectEl : el)?.getBoundingClientRect();
    if (!rect) return;
    const after = clientY > rect.top + rect.height / 2;
    const distance =
      clientY < rect.top
        ? rect.top - clientY
        : clientY > rect.bottom
          ? clientY - rect.bottom
          : 0;
    const pos = after ? childStart + child.nodeSize : childStart;
    if (distance < bestDistance) {
      bestPos = pos;
      bestDistance = distance;
    }
    fallback = childStart + child.nodeSize;
  });

  return bestPos ?? fallback;
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
    listInsertAt != null && shape.listItemNode
      ? shape.listItemNode
      : shape.insertNode,
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
    listInsertAt != null && shape.listItemNode
      ? shape.listItemNode
      : shape.insertNode,
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
    listInsertAt != null && shape.listItemNode
      ? shape.listItemNode
      : shape.insertNode,
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
  const tabPanelPos = tabPanelInsertionPosFromPoint(view, clientX, clientY);
  if (tabPanelPos != null) return tabPanelPos;

  const columnPos = columnInsertionPosFromPoint(view, clientX, clientY);
  if (columnPos != null) return columnPos;

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
    const parent = $pos.node(d - 1);
    const isValidParent =
      parent.type.name === "doc" || parent.type.name === "column";
    if (!isValidParent) continue;
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

  // column 내부의 패딩/빈 영역으로 떨어진 경우 column 끝에 삽입.
  for (let d = $pos.depth; d >= 1; d--) {
    const node = $pos.node(d);
    if (node.type.name !== "column") continue;
    const colStart = $pos.before(d);
    return colStart + node.nodeSize - 1;
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
    if (columnDropRef.current) {
      columnDropRef.current = null;
      clearColumnDropUi();
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
