import type { Editor } from "@tiptap/core";
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
