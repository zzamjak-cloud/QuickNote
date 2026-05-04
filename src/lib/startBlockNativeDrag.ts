import type { Editor } from "@tiptap/core";
import { NodeRangeSelection } from "@tiptap/extension-node-range";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/**
 * @tiptap/extension-drag-handle 의 nested drag 경로와 동일하게,
 * 현재 호버한 블록을 NodeSelection + slice 로 드래그한다.
 * (최상위·컬럼 내부 모두 blockStart 가 정확하므로 컨텍스트 기반 drag 와 맞춤)
 */
function getCSSText(element: Element) {
  let value = "";
  const style = getComputedStyle(element);
  for (let i = 0; i < style.length; i += 1) {
    const name = style.item(i);
    value += `${name}:${style.getPropertyValue(name)};`;
  }
  return value;
}

function cloneElement(node: Node): Node {
  const clonedNode = node.cloneNode(true) as Node;
  const el = node as Element;
  const cEl = clonedNode as Element;
  const sourceElements = [node, ...Array.from(el.getElementsByTagName("*"))];
  const targetElements = [
    clonedNode,
    ...Array.from(cEl.getElementsByTagName("*")),
  ];
  sourceElements.forEach((sourceElement, index) => {
    const targetElement = targetElements[index];
    if (targetElement instanceof HTMLElement && sourceElement instanceof HTMLElement) {
      targetElement.style.cssText = getCSSText(sourceElement);
    }
  });
  return clonedNode;
}

function getDraggedBlockElement(view: EditorView, pos: number): Element | null {
  const nodeDom = view.nodeDOM(pos);
  if (nodeDom instanceof Element && nodeDom !== view.dom) {
    return nodeDom;
  }
  const { node, offset } = view.domAtPos(pos);
  const child = node.childNodes[offset];
  if (child instanceof Element) {
    return child;
  }
  if (node instanceof Element) {
    return node;
  }
  if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
    return node.parentElement;
  }
  return null;
}

function getDraggedBlockDir(view: EditorView, pos: number) {
  const el = getDraggedBlockElement(view, pos);
  const contentDir = el
    ? getComputedStyle(el).direction
    : getComputedStyle(view.dom).direction;
  return contentDir || "ltr";
}

function getDragImageOffset(direction: string, wrapperWidth: number) {
  return direction === "rtl" ? wrapperWidth : 0;
}

function removeNode(node: Node) {
  node.parentNode?.removeChild(node);
}

/** doc 직속 블럭 시작 위치들이 문서 순서로 빈틈 없이 이어져 있으면 정렬된 배열, 아니면 null */
export function sortedContiguousTopLevelBlockStarts(
  doc: PMNode,
  starts: readonly number[],
): number[] | null {
  const uniq = [...new Set(starts)].sort((a, b) => a - b);
  if (uniq.length === 0) return null;
  for (const pos of uniq) {
    const node = doc.nodeAt(pos);
    if (!node || !node.isBlock) return null;
  }
  for (let i = 1; i < uniq.length; i++) {
    const prev = doc.nodeAt(uniq[i - 1]!);
    if (!prev) return null;
    if (uniq[i] !== uniq[i - 1]! + prev.nodeSize) return null;
  }
  return uniq;
}

/**
 * 연속된 최상위 블럭 여러 개 — slice + NodeRangeSelection, dragging.node 없음 → 드롭 시 deleteSelection
 */
function startContiguousBlocksNativeDrag(
  editor: Editor,
  event: DragEvent,
  sortedBlockStarts: number[],
): void {
  const { view } = editor;
  if (!event.dataTransfer || sortedBlockStarts.length < 2) return;

  const { doc } = view.state;
  const fromPos = sortedBlockStarts[0]!;
  const lastStart = sortedBlockStarts[sortedBlockStarts.length - 1]!;
  const lastNode = doc.nodeAt(lastStart);
  if (lastNode == null) return;
  const toPos = lastStart + lastNode.nodeSize;

  const slice = doc.slice(fromPos, toPos);
  // depth 0 — top-level 블록(doc 직속 자식)들의 범위.
  // depth 1 로 두면 fromPos/toPos 가 블록 경계(=depth 0 위치)일 때 $from.before(2) 가
  // 정의되지 않아 NodeRangeSelection 내부 doc.resolve(undefined) 가 RangeError 를 던진다.
  const selection = NodeRangeSelection.create(doc, fromPos, toPos, 0);

  const wrapper = document.createElement("div");
  const direction = getDraggedBlockDir(view, fromPos);
  wrapper.setAttribute("dir", direction);

  for (const start of sortedBlockStarts) {
    const element = getDraggedBlockElement(view, start);
    if (!element) continue;
    const clonedElement = cloneElement(element);
    if (clonedElement instanceof HTMLElement) {
      clonedElement.style.margin = "0";
    }
    wrapper.append(clonedElement);
  }
  wrapper.style.position = "absolute";
  wrapper.style.top = "-10000px";
  document.body.append(wrapper);
  event.dataTransfer.clearData();
  event.dataTransfer.setData("text/html", "");
  const wrapperRect = wrapper.getBoundingClientRect();
  const dragImageX = getDragImageOffset(direction, wrapperRect.width);
  event.dataTransfer.setDragImage(wrapper, dragImageX, 0);
  event.dataTransfer.effectAllowed = "move";

  let cleanedUp = false;
  const cleanupDragPreview = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    removeNode(wrapper);
    document.removeEventListener("drop", cleanupDragPreview);
    document.removeEventListener("dragend", cleanupDragPreview);
  };

  view.dragging = {
    slice,
    move: true,
  } as typeof view.dragging;
  const tr = view.state.tr.setSelection(selection);
  view.dispatch(tr);
  document.addEventListener("drop", cleanupDragPreview);
  document.addEventListener("dragend", cleanupDragPreview);
}

/**
 * 그립 드래그: 박스로 연속 선택된 블럭이 그립 블럭을 포함하면 한꺼번에 이동, 아니면 단일 블럭.
 */
export function startGripNativeDrag(
  editor: Editor,
  event: DragEvent,
  blockStart: number,
  node: PMNode,
  boxSelectedStarts?: readonly number[],
): void {
  const doc = editor.state.doc;
  const chain =
    boxSelectedStarts?.length && boxSelectedStarts.includes(blockStart)
      ? sortedContiguousTopLevelBlockStarts(doc, boxSelectedStarts)
      : null;
  if (chain && chain.length > 1) {
    startContiguousBlocksNativeDrag(editor, event, chain);
    return;
  }
  startBlockNativeDrag(editor, event, blockStart, node);
}

/**
 * HTML5 drag — ProseMirror view.dragging 과 맞춤
 */
export function startBlockNativeDrag(
  editor: Editor,
  event: DragEvent,
  blockStart: number,
  node: PMNode,
): void {
  const { view } = editor;
  if (!event.dataTransfer) return;

  const { doc } = view.state;
  const from = blockStart;
  const to = blockStart + node.nodeSize;

  const ranges = [
    {
      $from: doc.resolve(from),
      $to: doc.resolve(to),
    },
  ];

  const tr = view.state.tr;
  const wrapper = document.createElement("div");
  const fromPos = ranges[0]!.$from.pos;
  const toPos = ranges[ranges.length - 1]!.$to.pos;
  const direction = getDraggedBlockDir(view, fromPos);
  wrapper.setAttribute("dir", direction);

  const slice = view.state.doc.slice(fromPos, toPos);
  const selection = NodeSelection.create(view.state.doc, fromPos);

  ranges.forEach((range) => {
    const element = getDraggedBlockElement(view, range.$from.pos);
    if (!element) return;
    const clonedElement = cloneElement(element);
    if (clonedElement instanceof HTMLElement) {
      clonedElement.style.margin = "0";
    }
    wrapper.append(clonedElement);
  });
  wrapper.style.position = "absolute";
  wrapper.style.top = "-10000px";
  document.body.append(wrapper);
  event.dataTransfer.clearData();
  event.dataTransfer.setData("text/html", ""); // 일부 브라우저에서 drag 활성화
  const wrapperRect = wrapper.getBoundingClientRect();
  const dragImageX = getDragImageOffset(direction, wrapperRect.width);
  event.dataTransfer.setDragImage(wrapper, dragImageX, 0);
  event.dataTransfer.effectAllowed = "move";

  let cleanedUp = false;
  const cleanupDragPreview = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    removeNode(wrapper);
    document.removeEventListener("drop", cleanupDragPreview);
    document.removeEventListener("dragend", cleanupDragPreview);
  };
  const nodeSelection =
    selection instanceof NodeSelection ? selection : undefined;
  view.dragging = {
    slice,
    move: true,
    ...(nodeSelection ? { node: nodeSelection } : {}),
  } as typeof view.dragging;
  tr.setSelection(selection);
  view.dispatch(tr);
  document.addEventListener("drop", cleanupDragPreview);
  document.addEventListener("dragend", cleanupDragPreview);
}
