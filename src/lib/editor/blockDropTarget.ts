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

/** 컬럼·탭 패널·콜아웃·토글 본문 등 block+ 컨테이너 내부 삽입 위치 (공통) */
function containerChildInsertionPosFromPoint(
  view: EditorView,
  clientY: number,
  containerEl: HTMLElement,
  containerTypeName: string,
): number | null {
  let containerStart: number | null = null;
  let containerNode: PMNode | null = null;
  try {
    let rawPos: number | null = null;
    try {
      rawPos = view.posAtDOM(containerEl, 0);
    } catch {
      try {
        rawPos = view.posAtDOM(containerEl, 1);
      } catch {
        rawPos = null;
      }
    }
    if (rawPos == null) return null;
    const $raw = view.state.doc.resolve(
      Math.max(0, Math.min(rawPos, view.state.doc.content.size)),
    );
    for (let d = $raw.depth; d >= 1; d--) {
      if ($raw.node(d).type.name !== containerTypeName) continue;
      containerStart = $raw.before(d);
      containerNode = $raw.node(d);
      break;
    }
    if (containerStart == null) {
      const maybeNode = view.state.doc.nodeAt(rawPos);
      if (maybeNode?.type.name === containerTypeName) {
        containerStart = rawPos;
        containerNode = maybeNode;
      }
    }
  } catch {
    containerStart = null;
    containerNode = null;
  }
  if (
    containerStart == null ||
    !containerNode ||
    containerNode.type.name !== containerTypeName
  ) {
    return null;
  }

  let fallback = containerStart + containerNode.nodeSize - 1;
  let bestPos: number | null = null;
  let bestDistance = Infinity;
  containerNode.forEach((child, offset) => {
    const childStart = containerStart! + 1 + offset;
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

function resolveCalloutBodyElementFromPoint(
  view: EditorView,
  clientX: number,
  clientY: number,
): HTMLElement | null {
  const hit = document.elementFromPoint(clientX, clientY);
  if (!hit || !view.dom.contains(hit)) return null;
  const direct = hit.closest("[data-callout-body], .callout-body");
  if (direct instanceof HTMLElement && view.dom.contains(direct)) return direct;
  const root = hit.closest("[data-callout]");
  if (!(root instanceof HTMLElement) || !view.dom.contains(root)) return null;
  const body = root.querySelector("[data-callout-body], .callout-body");
  return body instanceof HTMLElement ? body : root;
}

function nearestColumnElementFromLayoutHit(
  view: EditorView,
  hit: Element | null,
  clientX: number,
): HTMLElement | null {
  const layout = hit?.closest?.("[data-column-layout]");
  if (!(layout instanceof HTMLElement) || !view.dom.contains(layout)) return null;
  const columns = Array.from(layout.querySelectorAll<HTMLElement>("[data-column]"));
  if (columns.length === 0) return null;
  return columns.reduce<HTMLElement | null>((best, column) => {
    if (!best) return column;
    const bestRect = best.getBoundingClientRect();
    const rect = column.getBoundingClientRect();
    const bestDistance =
      clientX < bestRect.left
        ? bestRect.left - clientX
        : clientX > bestRect.right
          ? clientX - bestRect.right
          : 0;
    const distance =
      clientX < rect.left
        ? rect.left - clientX
        : clientX > rect.right
          ? clientX - rect.right
          : 0;
    return distance < bestDistance ? column : best;
  }, null);
}

function toggleBlockInsertionPosFromPoint(
  view: EditorView,
  clientX: number,
  clientY: number,
): number | null {
  const hit = document.elementFromPoint(clientX, clientY);
  const toggleEl = hit?.closest?.(".toggle-block");
  if (!(toggleEl instanceof HTMLElement) || !view.dom.contains(toggleEl)) {
    return null;
  }

  let toggleStart: number | null = null;
  let toggleNode: PMNode | null = null;
  try {
    const rawPos = view.posAtDOM(toggleEl, 0);
    const $raw = view.state.doc.resolve(
      Math.max(0, Math.min(rawPos, view.state.doc.content.size)),
    );
    for (let d = $raw.depth; d >= 1; d--) {
      if ($raw.node(d).type.name !== "toggle") continue;
      toggleStart = $raw.before(d);
      toggleNode = $raw.node(d);
      break;
    }
    if (toggleStart == null) {
      const maybeNode = view.state.doc.nodeAt(rawPos);
      if (maybeNode?.type.name === "toggle") {
        toggleStart = rawPos;
        toggleNode = maybeNode;
      }
    }
  } catch {
    toggleStart = null;
    toggleNode = null;
  }
  if (toggleStart == null || !toggleNode || toggleNode.type.name !== "toggle") {
    return null;
  }

  let offset = 0;
  for (let i = 0; i < toggleNode.childCount; i += 1) {
    const child = toggleNode.child(i);
    if (child.type.name === "toggleContent") {
      const contentStart = toggleStart + 1 + offset;
      return contentStart + child.nodeSize - 1;
    }
    offset += child.nodeSize;
  }
  return null;
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
      if (name === "toggleContent" && !containers.includes("toggleContent")) {
        containers.push("toggleContent");
      }
      if (name === "callout" && !containers.includes("callout")) {
        containers.push("callout");
      }
    }
    return containers.length > 0 ? containers : ["doc"];
  } catch {
    return ["doc"];
  }
}

/**
 * 드롭 좌표가 글머리 항목(listItem/taskItem) 내부에 있으면 그 항목의 첫 문단 뒤
 * (= 중첩 블록 자리) 위치를 반환한다. 그렇지 않으면 null.
 *
 * containerChildInsertionPosFromPoint 는 컨테이너(토글·콜아웃·컬럼)의 직속 자식만 순회하므로
 * 리스트 전체를 한 단위로만 보고 항목 안으로 하강하지 못한다. 그 결과 항목 위로 드롭해도
 * "리스트 이전 블록"에 삽입되는 버그가 있었다. 위치 계산 맨 앞에서 이 함수를 먼저 시도해
 * 토글·콜아웃·컬럼·doc 어디에 있든 이미지·파일 등을 글머리 항목의 자식으로 넣는다.
 */
function listItemInteriorInsertionPos(
  view: EditorView,
  clientX: number,
  clientY: number,
): number | null {
  const coords = view.posAtCoords({ left: clientX, top: clientY });
  if (!coords) return null;
  let $pos;
  try {
    $pos = view.state.doc.resolve(coords.pos);
  } catch {
    return null;
  }
  for (let d = $pos.depth; d >= 1; d--) {
    const node = $pos.node(d);
    if (node.type.name !== "listItem" && node.type.name !== "taskItem") continue;
    const itemStart = $pos.start(d);
    let offsetInItem = 0;
    let firstParagraphEnd: number | null = null;
    node.content.forEach((child) => {
      if (firstParagraphEnd != null) return;
      if (child.type.name === "paragraph") {
        firstParagraphEnd = itemStart + offsetInItem + child.nodeSize;
      }
      offsetInItem += child.nodeSize;
    });
    // 첫 문단이 있으면 그 뒤(중첩 리스트 앞), 없으면 항목 내부 끝으로.
    return firstParagraphEnd ?? itemStart + node.content.size;
  }
  return null;
}

/**
 * 드롭 지점에 겹치는 중첩 컨테이너(콜아웃 본문·토글 본문·토글 헤더·탭 패널·컬럼) 후보를
 * 모두 수집한 뒤, DOM 상 가장 깊은(안쪽) 컨테이너부터 삽입 위치를 해석한다.
 *
 * 고정 타입 순서(콜아웃→토글→탭→컬럼)로 해석하면 "토글 안 컬럼" 같은 역방향 중첩에서
 * 바깥 토글 본문이 먼저 매칭되어 안쪽 컬럼에 드롭할 수 없는 버그가 있었다.
 */
function nestedContainerInsertionPosFromPoint(
  view: EditorView,
  clientX: number,
  clientY: number,
): number | null {
  const hit = document.elementFromPoint(clientX, clientY);

  type Candidate = { el: HTMLElement; resolve: () => number | null };
  const candidates: Candidate[] = [];

  const calloutBody = resolveCalloutBodyElementFromPoint(view, clientX, clientY);
  if (calloutBody) {
    candidates.push({
      el: calloutBody,
      resolve: () =>
        containerChildInsertionPosFromPoint(view, clientY, calloutBody, "callout"),
    });
  }

  const toggleContentEl = hit?.closest?.("[data-toggle-content]");
  if (toggleContentEl instanceof HTMLElement && view.dom.contains(toggleContentEl)) {
    candidates.push({
      el: toggleContentEl,
      resolve: () =>
        containerChildInsertionPosFromPoint(
          view,
          clientY,
          toggleContentEl,
          "toggleContent",
        ),
    });
  }

  // 토글 헤더 등 본문 밖 히트 대비: .toggle-block 자체도 후보로 두되,
  // 본문([data-toggle-content]) 후보가 있으면 그쪽이 더 깊어 먼저 해석된다.
  const toggleEl = hit?.closest?.(".toggle-block");
  if (toggleEl instanceof HTMLElement && view.dom.contains(toggleEl)) {
    candidates.push({
      el: toggleEl,
      resolve: () => toggleBlockInsertionPosFromPoint(view, clientX, clientY),
    });
  }

  const tabPanelEl = resolveTabPanelElementFromPoint(view, clientX, clientY);
  if (tabPanelEl) {
    candidates.push({
      el: tabPanelEl,
      resolve: () =>
        containerChildInsertionPosFromPoint(view, clientY, tabPanelEl, "tabPanel"),
    });
  }

  const columnDirect = hit?.closest?.("[data-column]");
  const columnEl =
    columnDirect instanceof HTMLElement
      ? columnDirect
      : nearestColumnElementFromLayoutHit(view, hit ?? null, clientX);
  if (columnEl instanceof HTMLElement && view.dom.contains(columnEl)) {
    candidates.push({
      el: columnEl,
      resolve: () =>
        containerChildInsertionPosFromPoint(view, clientY, columnEl, "column"),
    });
  }

  if (candidates.length === 0) return null;

  const domDepth = (el: Element): number => {
    let depth = 0;
    for (let n = el.parentElement; n; n = n.parentElement) depth += 1;
    return depth;
  };
  // 깊은(안쪽) 컨테이너 우선. 동률이면 수집 순서(기존 우선순위) 유지.
  candidates.sort((a, b) => domDepth(b.el) - domDepth(a.el));
  for (const candidate of candidates) {
    const pos = candidate.resolve();
    if (pos != null) return pos;
  }
  return null;
}

export function topLevelInsertionPosFromDrop(
  view: EditorView,
  clientX: number,
  clientY: number,
  draggedNodes?: readonly PMNode[],
): number {
  // 글머리 항목 재정렬(listItem 자체 드래그)은 형제 위치 계산이 담당하므로, 그 경우엔
  // 항목 내부 삽입을 건너뛴다. 그 외(이미지·파일·콜아웃 등)는 항목 위로 드롭하면 자식으로 넣는다.
  const draggingListItem = draggedNodes?.some(
    (n) => n.type.name === "listItem" || n.type.name === "taskItem",
  );
  if (!draggingListItem) {
    const listItemPos = listItemInteriorInsertionPos(view, clientX, clientY);
    if (listItemPos != null) return listItemPos;
  }

  // 중첩 컨테이너는 고정 타입 순서가 아니라 드롭 지점 기준 가장 안쪽 컨테이너부터 해석한다.
  const containerPos = nestedContainerInsertionPosFromPoint(view, clientX, clientY);
  if (containerPos != null) return containerPos;

  const coords = view.posAtCoords({ left: clientX, top: clientY });
  if (!coords) return nearestTopLevelInsertionByY(view, clientY);

  let $pos;
  try {
    $pos = view.state.doc.resolve(coords.pos);
  } catch {
    return nearestTopLevelInsertionByY(view, clientY);
  }

  const CONTAINER_BLOCK_TYPES = new Set([
    "callout",
    "column",
    "tabPanel",
    "toggleContent",
    "columnLayout",
    "tabBlock",
    "toggle",
  ]);

  for (let d = $pos.depth; d >= 1; d--) {
    const node = $pos.node(d);
    if (!node.isBlock || node.type.name === "doc") continue;
    if (CONTAINER_BLOCK_TYPES.has(node.type.name)) continue;
    const parent = $pos.node(d - 1);
    const isValidParent =
      parent.type.name === "doc" ||
      parent.type.name === "column" ||
      parent.type.name === "tabPanel" ||
      parent.type.name === "toggleContent" ||
      parent.type.name === "callout";
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
  const insertAt = topLevelInsertionPosFromDrop(view, clientX, clientY, nodes);
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
  // containers 는 안쪽 컨테이너부터 정렬되어 있으므로 그 순서대로 매칭한다.
  for (const container of target.containers) {
    if (container === "column") {
      const column = hit?.closest?.("[data-column]");
      if (column instanceof HTMLElement && view.dom.contains(column)) return column;
    }
    if (container === "tabPanel") {
      const panel = hit?.closest?.("[data-tab-panel]");
      if (panel instanceof HTMLElement && view.dom.contains(panel)) return panel;
    }
    if (container === "toggleContent") {
      const content = hit?.closest?.("[data-toggle-content]");
      if (content instanceof HTMLElement && view.dom.contains(content)) return content;
    }
    if (container === "callout") {
      const body = resolveCalloutBodyElementFromPoint(view, clientX, clientY);
      if (body) return body;
    }
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

  // 삽입 지점 좌표 산출.
  // coordsAtPos 만 사용하면 image / fileBlock 같은 atom 블록의 직후 위치가 같은 줄(블록의 중앙 부근)
  // 으로 잡혀 시각적으로 오정렬되는 회귀가 있다.
  // 우선 삽입 위치 직전 노드(insertAt-1) 의 DOM rect 하단, 그게 없으면 직후 노드의 상단을 사용한다.
  // 모두 실패하면 coordsAtPos, 그것도 실패하면 pointerY 폴백.
  let top = clientY;
  const docSize = view.state.doc.content.size;
  const insertAt = Math.max(0, Math.min(target.insertAt, docSize));
  const beforeNode = insertAt > 0 ? view.state.doc.nodeAt(insertAt - 1) : null;
  let resolved = false;
  if (beforeNode && beforeNode.isBlock) {
    const beforePos = insertAt - beforeNode.nodeSize;
    try {
      const dom = view.nodeDOM(beforePos);
      const el = dom instanceof HTMLElement ? dom : dom?.parentElement ?? null;
      if (el) {
        top = el.getBoundingClientRect().bottom;
        resolved = true;
      }
    } catch {
      /* noop */
    }
  }
  if (!resolved && insertAt < docSize) {
    const afterNode = view.state.doc.nodeAt(insertAt);
    if (afterNode && afterNode.isBlock) {
      try {
        const dom = view.nodeDOM(insertAt);
        const el = dom instanceof HTMLElement ? dom : dom?.parentElement ?? null;
        if (el) {
          top = el.getBoundingClientRect().top;
          resolved = true;
        }
      } catch {
        /* noop */
      }
    }
  }
  if (!resolved) {
    try {
      const coords = view.coordsAtPos(insertAt);
      top = coords.top;
    } catch {
      /* pointerY 폴백 유지 */
    }
  }

  const horizontalInset =
    target.containers.includes("column") ||
    target.containers.includes("tabPanel") ||
    target.containers.includes("callout")
      ? 6
      : 48;
  const left = containerRect.left + horizontalInset;
  const width = Math.max(24, containerRect.width - horizontalInset * 2);
  return { top, left, width };
}
