import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import {
  canDropNodeTypeInContainers,
  type DropContainerType,
} from "../blocks/dndPolicy";
import { forEachDocDirectBlock } from "../pm/topLevelBlocks";
import { queryTabPanelElements } from "../tiptapExtensions/tabPanelDom";

export type BlockDropTarget = {
  insertAt: number;
  containers: DropContainerType[];
  allowed: boolean;
};

export type BlockDropIndicatorRect = {
  top: number;
  left: number;
  width: number;
};

function rectForBlockDom(view: EditorView, blockStart: number): DOMRect | null {
  const dom = view.nodeDOM(blockStart);
  const el = dom instanceof Element ? dom : dom?.parentElement;
  const rectEl =
    el instanceof Element ? el.closest(".qn-database-block") ?? el : null;
  return (rectEl instanceof HTMLElement ? rectEl : el)?.getBoundingClientRect() ?? null;
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
  return panels[idx] ?? null;
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
    const rect = rectForBlockDom(view, childStart);
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
    const rect = rectForBlockDom(view, childStart);
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

/** doc 직속 자식의 화면 rect 를 모아 Y 좌표 기준 가장 가까운 블록을 찾아 삽입 위치 반환. */
function nearestTopLevelInsertionByY(view: EditorView, clientY: number): number {
  let bestStart: number | null = null;
  let bestEnd: number | null = null;
  let bestDistance = Infinity;
  let bestAfter = false;
  forEachDocDirectBlock(view.state.doc, (node, blockStart) => {
    const rect = rectForBlockDom(view, blockStart);
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

export function insertionContainersAt(
  view: EditorView,
  insertAt: number,
): DropContainerType[] {
  const docSize = view.state.doc.content.size;
  const pos = Math.max(0, Math.min(insertAt, docSize));
  try {
    const $pos = view.state.doc.resolve(pos);
    const containers: DropContainerType[] = [];
    for (let d = $pos.depth; d >= 0; d--) {
      const name = $pos.node(d).type.name;
      if (name === "column" && !containers.includes("column")) {
        containers.push("column");
      }
      if (name === "tabPanel" && !containers.includes("tabPanel")) {
        containers.push("tabPanel");
      }
    }
    return containers.length > 0 ? containers : ["doc"];
  } catch {
    return ["doc"];
  }
}

export function topLevelInsertionPosFromDrop(
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
      parent.type.name === "doc" ||
      parent.type.name === "column" ||
      parent.type.name === "tabPanel";
    if (!isValidParent) continue;
    const targetStart = $pos.before(d);
    const rect = rectForBlockDom(view, targetStart);
    const after = rect ? clientY > rect.top + rect.height / 2 : false;
    return after ? targetStart + node.nodeSize : targetStart;
  }

  for (let d = $pos.depth; d >= 1; d--) {
    const node = $pos.node(d);
    if (node.type.name !== "column") continue;
    const colStart = $pos.before(d);
    return colStart + node.nodeSize - 1;
  }

  return nearestTopLevelInsertionByY(view, clientY);
}

export function canDropNodeAtInsertionPos(
  view: EditorView,
  node: PMNode,
  insertAt: number,
): boolean {
  return canDropNodeTypeInContainers(
    node.type.name,
    insertionContainersAt(view, insertAt),
  );
}

export function resolveBlockDropTarget(
  view: EditorView,
  clientX: number,
  clientY: number,
  nodes: readonly PMNode[],
): BlockDropTarget {
  const insertAt = topLevelInsertionPosFromDrop(view, clientX, clientY);
  const containers = insertionContainersAt(view, insertAt);
  const allowed = nodes.every((node) =>
    canDropNodeTypeInContainers(node.type.name, containers),
  );
  return { insertAt, containers, allowed };
}

function indicatorContainerElement(
  view: EditorView,
  target: BlockDropTarget,
  clientX: number,
  clientY: number,
): HTMLElement {
  const hit = document.elementFromPoint(clientX, clientY);
  if (target.containers.includes("column")) {
    const column = hit?.closest?.("[data-column]");
    if (column instanceof HTMLElement && view.dom.contains(column)) return column;
  }
  if (target.containers.includes("tabPanel")) {
    const panel = hit?.closest?.("[data-tab-panel]");
    if (panel instanceof HTMLElement && view.dom.contains(panel)) return panel;
  }
  return view.dom;
}

export function resolveBlockDropIndicatorRect(
  view: EditorView,
  target: BlockDropTarget,
  clientX: number,
  clientY: number,
): BlockDropIndicatorRect | null {
  if (!target.allowed) return null;
  const container = indicatorContainerElement(view, target, clientX, clientY);
  const containerRect = container.getBoundingClientRect();
  if (containerRect.width <= 0) return null;

  let top = clientY;
  try {
    const coords = view.coordsAtPos(
      Math.max(0, Math.min(target.insertAt, view.state.doc.content.size)),
    );
    top = coords.top;
  } catch {
    /* 좌표 산출 실패 시 포인터 Y를 폴백으로 사용 */
  }

  const horizontalInset =
    target.containers.includes("column") || target.containers.includes("tabPanel")
      ? 6
      : 48;
  const left = containerRect.left + horizontalInset;
  const width = Math.max(24, containerRect.width - horizontalInset * 2);
  return { top, left, width };
}
