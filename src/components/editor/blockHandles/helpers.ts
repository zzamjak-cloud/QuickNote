// BlockHandles 의 순수 PM/좌표 헬퍼 + 상수 + 타입.
// BlockHandles.tsx 에서 분리 — 동작 변경 없음.

import type { Editor } from "@tiptap/react";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import {
  CheckSquare,
  ChevronRight,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Lightbulb,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
} from "lucide-react";
import { reportNonFatal } from "../../../lib/reportNonFatal";
import {
  shouldFlattenWrapperBeforeTypeChange,
  shouldSuppressBlockHandle,
  shouldUseDatabaseBlockChrome,
} from "../../../lib/blocks/uiPolicy";

export type HoverInfo = {
  rect: DOMRect;
  blockStart: number;
  depth: number;
  node: PMNode;
};

export const HANDLE_STRIP_PX = 32;
export const MIN_HANDLE_LEFT = 6;
export const GRIP_SIZE_PX = 28;
export const GRIP_ZONE_PAD_PX = 14;
export const GUTTER_LEFT_PX = 56;
export const RECT_PAD_X = 20;
/** 블록 오른쪽 바깥 — 댓글 수 배지가 본문과 겹치지 않도록 간격 */
export const COMMENT_BTN_GAP_PX = 8;
export const RECT_PAD_Y = 18;
export const HANDLE_TOP_OFFSET_PX = -2;
const LIST_ITEM_HANDLE_EXTRA_LEFT_PX = 18;
const LIST_HANDLE_NODE_TYPES = new Set(["listItem", "taskItem"]);

export function isListHandleNodeType(typeName: string): boolean {
  return LIST_HANDLE_NODE_TYPES.has(typeName);
}

export function listElementForHover(editor: Editor, hover: HoverInfo): HTMLElement | null {
  if (!isListHandleNodeType(hover.node.type.name)) return null;
  const dom = editor.view.nodeDOM(hover.blockStart);
  return dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null);
}

export function visualElementForBlockNode(
  typeName: string,
  el: HTMLElement,
): HTMLElement {
  if (typeName === "image") {
    return el.matches("img")
      ? el
      : (el.querySelector("img") as HTMLElement | null) ?? el;
  }
  return shouldUseDatabaseBlockChrome(typeName)
    ? (el.closest(".qn-database-block") as HTMLElement | null) ?? el
    : el;
}

function rectContainsPoint(rect: DOMRect, clientX: number, clientY: number): boolean {
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

export function isAncestorListHover(
  editor: Editor,
  maybeAncestor: HoverInfo,
  maybeDescendant: HoverInfo,
): boolean {
  const ancestorEl = listElementForHover(editor, maybeAncestor);
  const descendantEl = listElementForHover(editor, maybeDescendant);
  return Boolean(
    ancestorEl &&
      descendantEl &&
      ancestorEl !== descendantEl &&
      ancestorEl.contains(descendantEl),
  );
}

export function pointInsideListSiblingGroup(
  editor: Editor,
  hover: HoverInfo,
  clientX: number,
  clientY: number,
): boolean {
  const itemEl = listElementForHover(editor, hover);
  const listEl = itemEl?.parentElement;
  if (!(listEl instanceof HTMLElement)) return false;
  const itemRects = Array.from(listEl.children)
    .filter((child) => child.tagName.toLowerCase() === "li")
    .map((child) => child.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
  const rects = itemRects.length > 0 ? itemRects : [listEl.getBoundingClientRect()];
  const left = Math.min(...rects.map((rect) => rect.left)) - GUTTER_LEFT_PX;
  const right = Math.max(...rects.map((rect) => rect.right)) + RECT_PAD_X;
  const top = Math.min(...rects.map((rect) => rect.top)) - 2;
  const bottom = Math.max(...rects.map((rect) => rect.bottom)) + 2;
  return clientX >= left && clientX <= right && clientY >= top && clientY <= bottom;
}

export function pointInsideListOwnRow(
  editor: Editor,
  hover: HoverInfo,
  clientX: number,
  clientY: number,
): boolean {
  const itemEl = listElementForHover(editor, hover);
  return itemEl instanceof HTMLElement
    ? listItemOwnRowContainsPoint(itemEl, clientX, clientY)
    : false;
}

export function resolveHandleLeft(
  hover: HoverInfo,
  wrapperRect: DOMRect,
): number {
  // 표 블럭은 좌상단 모서리에 핸들을 붙여야 인지성이 좋아서 공통 거터 오프셋을 우회한다.
  if (hover.node.type.name === "table") {
    const tableEdgeLeft = hover.rect.left - wrapperRect.left - 10;
    return Math.max(MIN_HANDLE_LEFT, tableEdgeLeft);
  }
  const extraLeft = isListHandleNodeType(hover.node.type.name) ? LIST_ITEM_HANDLE_EXTRA_LEFT_PX : 0;
  const rawLeft = hover.rect.left - wrapperRect.left - HANDLE_STRIP_PX - extraLeft;
  return Math.max(MIN_HANDLE_LEFT, rawLeft);
}

export function resolveHandleTop(
  hover: HoverInfo,
  wrapperRect: DOMRect,
): number {
  if (hover.node.type.name === "horizontalRule") {
    return hover.rect.top - wrapperRect.top + hover.rect.height / 2 - GRIP_SIZE_PX / 2;
  }
  const tableTopNudge = hover.node.type.name === "table" ? -14 : 0;
  const columnNoneTopNudge =
    hover.node.type.name === "columnLayout" && hover.node.attrs.preset === "none"
      ? -18
      : 0;
  return hover.rect.top - wrapperRect.top + HANDLE_TOP_OFFSET_PX + tableTopNudge + columnNoneTopNudge;
}

/** wrapper(콜아웃·토글·인용) 블록을 그 안의 텍스트만 담은 단일 paragraph로 치환.
 *  치환 성공 시 true 반환 — 호출자는 이후 setHeading 등 단일 타입 명령을 적용한다. */
/** 토글 헤더 titleLevel 변경 — 본문·open 상태는 유지 */
export function applyToggleTitleLevel(
  editor: Editor,
  blockStart: number,
  level: 1 | 2 | 3 | null,
): void {
  const node = editor.state.doc.nodeAt(blockStart);
  if (!node || node.type.name !== "toggle") return;

  let headerOffset: number | null = null;
  let headerNode: PMNode | null = null;
  node.forEach((child, offset) => {
    if (child.type.name === "toggleHeader") {
      headerOffset = offset;
      headerNode = child;
    }
  });
  if (headerOffset === null || !headerNode) return;
  const resolvedHeaderNode: PMNode = headerNode;

  const headerPos = blockStart + 1 + headerOffset;
  const tr = editor.state.tr.setNodeMarkup(headerPos, undefined, {
    ...resolvedHeaderNode.attrs,
    titleLevel: level === null ? null : String(level),
  });
  editor.view.dispatch(tr);
}

/** wrapper(콜아웃·토글·인용) 블록을 타입 변경할 때, 내부 블록을 버리지 않고
 *  그대로 바깥으로 꺼낸다(unwrap). 내부 블록(이미지·리스트·중첩 블록 등)이 보존된다.
 *  - callout/blockquote: 내부 블록들을 그대로 끌어올림.
 *  - toggle: 헤더 인라인을 paragraph 로, toggleContent 의 블록들을 그 뒤로 끌어올림.
 *  치환 성공 시 true 반환 — 호출자는 첫 블록에 setHeading/setParagraph 등 단일 타입 명령을 적용한다. */
export function unwrapWrapperBlock(editor: Editor, blockStart: number): boolean {
  const node = editor.state.doc.nodeAt(blockStart);
  if (!node || !shouldFlattenWrapperBeforeTypeChange(node.type.name)) return false;
  const paragraphType = editor.schema.nodes.paragraph;
  if (!paragraphType) return false;

  const blocks: PMNode[] = [];
  if (node.type.name === "toggle") {
    node.forEach((child) => {
      if (child.type.name === "toggleHeader") {
        blocks.push(paragraphType.create(null, child.content));
      } else if (child.type.name === "toggleContent") {
        child.forEach((b) => blocks.push(b));
      } else {
        blocks.push(child);
      }
    });
  } else {
    node.forEach((child) => blocks.push(child));
  }

  // 내용이 비어 있으면 빈 paragraph 하나로 대체(빈 자리 방지).
  const replacement = blocks.length > 0 ? blocks : [paragraphType.create()];
  editor.view.dispatch(
    editor.state.tr.replaceWith(blockStart, blockStart + node.nodeSize, replacement),
  );
  return true;
}

/** 렌더와 동일한 수식으로 그립 버튼의 화면 영역을 내고, 호버가 풀리지 않게 한다. */
export function pointInGripZone(
  clientX: number,
  clientY: number,
  hover: HoverInfo,
  wrapperRect: DOMRect,
): boolean {
  const top = resolveHandleTop(hover, wrapperRect);
  const left = resolveHandleLeft(hover, wrapperRect);
  const z = GRIP_ZONE_PAD_PX;
  const x0 = wrapperRect.left + left - z;
  const y0 = wrapperRect.top + top - z;
  const x1 = wrapperRect.left + left + GRIP_SIZE_PX + z;
  const y1 = wrapperRect.top + top + GRIP_SIZE_PX + z;
  return clientX >= x0 && clientX <= x1 && clientY >= y0 && clientY <= y1;
}

export function hoverFromResolvedPos(
  editor: Editor,
  $pos: ResolvedPos,
): HoverInfo | null {
  // 표(table) 내부 블록은 BlockHandles 표시 안 함 — TableBlockControls 가 처리
  for (let d = 0; d <= $pos.depth; d++) {
    if ($pos.node(d).type.name === "table") return null;
  }
  // wrapper(콜아웃/토글/인용) 안의 내부 블럭이 우선 — wrapper는 fallback.
  let inner: HoverInfo | null = null;
  let wrapper: HoverInfo | null = null;
  let taskItem: HoverInfo | null = null;
  let listItem: HoverInfo | null = null;
  for (let d = $pos.depth; d > 0; d--) {
    const n = $pos.node(d);
    if (!n.isBlock || n.type.name === "doc") continue;
    if (shouldSuppressBlockHandle(n.type.name)) continue;
    const start = $pos.before(d);
    const dom = editor.view.nodeDOM(start);
    const el = dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null);
    if (!el) continue;
    const rectEl = visualElementForBlockNode(n.type.name, el);
    const candidate: HoverInfo = {
      rect: rectEl.getBoundingClientRect(),
      blockStart: start,
      depth: d,
      node: n,
    };
    if (shouldFlattenWrapperBeforeTypeChange(n.type.name)) {
      // 가장 외곽 wrapper만 보존 (깊이 작은 것)
      if (!wrapper || candidate.depth < wrapper.depth) wrapper = candidate;
    } else if (n.type.name === "taskItem") {
      // 체크박스와 텍스트는 하나의 이동 단위여야 하므로 내부 paragraph보다 taskItem을 우선한다.
      if (!taskItem || candidate.depth > taskItem.depth) taskItem = candidate;
    } else if (n.type.name === "listItem") {
      // 불릿/번호 마커와 텍스트도 하나의 이동 단위이므로 내부 paragraph보다 listItem을 우선한다.
      if (!listItem || candidate.depth > listItem.depth) listItem = candidate;
    } else {
      // inner는 가장 깊은 것
      if (!inner || candidate.depth > inner.depth) inner = candidate;
    }
  }
  // atom 블록(image / fileBlock / databaseBlock / horizontalRule 등)은 자기 자신이
  // ancestor 로 들어오지 않아 위 루프가 잡지 못한다. doc 직속이든 콜아웃/blockquote/컬럼 내부든
  // 부모 컨테이너에서 이 atom 을 가리키는 인덱스에 닿을 수 있으므로, $pos.parent 의 nodeAfter/nodeBefore 를
  // 모두 검사한다. (이전에는 parent.type === "doc" 일 때만 동작해 콜아웃 안 이미지가 드래그 핸들로 잡히지 않았다.)
  if (!inner) {
    const idx = $pos.index();
    const probes: { node: PMNode; start: number }[] = [];
    const after = $pos.parent.maybeChild(idx);
    if (after) probes.push({ node: after, start: $pos.posAtIndex(idx) });
    if (idx > 0) {
      const before = $pos.parent.maybeChild(idx - 1);
      if (before) probes.push({ node: before, start: $pos.posAtIndex(idx - 1) });
    }
    for (const p of probes) {
      const n = p.node;
      if (!n.isBlock || !n.isAtom) continue;
      if (shouldSuppressBlockHandle(n.type.name)) continue;
      const dom = editor.view.nodeDOM(p.start);
      const el = dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null);
      if (!el) continue;
      const rectEl = visualElementForBlockNode(n.type.name, el);
      inner = {
        rect: rectEl.getBoundingClientRect(),
        blockStart: p.start,
        // 깊이는 부모 컨테이너 + 1 — wrapper(콜아웃/컬럼) 보다 우선되도록 보장.
        depth: $pos.depth + 1,
        node: n,
      };
      break;
    }
  }
  // inner 가 atom 블록(image / fileBlock / horizontalRule 등) 또는 paragraph 가 아닌
  // 블록(codeBlock 등) 이면 list/task 항목보다 먼저 반환한다. list/task 우선 규칙은
  // 마커+텍스트(paragraph)를 하나의 이동 단위로 묶기 위한 것이므로, 글머리·번호·체크 항목
  // 안에 중첩된 코드 블록·이미지가 자기 드래그 핸들을 갖지 못하던 회귀를 함께 방지한다.
  if (inner && (inner.node.isAtom || inner.node.type.name !== "paragraph")) {
    return inner;
  }
  return taskItem ?? listItem ?? inner ?? wrapper;
}

function hoverFromListItemElement(
  editor: Editor,
  listItemEl: HTMLElement,
): HoverInfo | null {
  const view = editor.view;
  const positions: number[] = [];
  try {
    positions.push(view.posAtDOM(listItemEl, 0));
  } catch {
    /* noop */
  }
  try {
    positions.push(view.posAtDOM(listItemEl, 1));
  } catch {
    /* noop */
  }

  for (const pos of positions) {
    let $pos: ResolvedPos;
    try {
      const max = editor.state.doc.content.size;
      $pos = editor.state.doc.resolve(Math.min(Math.max(0, pos), max));
    } catch {
      continue;
    }
    for (let d = $pos.depth; d > 0; d--) {
      const node = $pos.node(d);
      if (!isListHandleNodeType(node.type.name)) continue;
      const start = $pos.before(d);
      const dom = view.nodeDOM(start);
      const el = dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null);
      if (el && el !== listItemEl && !el.contains(listItemEl) && !listItemEl.contains(el)) {
        continue;
      }
      return {
        rect: (el ?? listItemEl).getBoundingClientRect(),
        blockStart: start,
        // elementsFromPoint 의 가장 가까운 li 를 리스트 그룹 안에서 우선한다.
        depth: d + 100,
        node,
      };
    }
  }
  return null;
}

function listItemOwnRowContainsPoint(
  listItemEl: HTMLElement,
  clientX: number,
  clientY: number,
): boolean {
  const itemRect = listItemEl.getBoundingClientRect();
  if (!rectContainsPoint(itemRect, clientX, clientY)) return false;

  // own row = 리스트 마커 + 첫 텍스트 라인. 그 아래에 중첩된 블록(코드블럭·이미지·표·중첩 리스트
  // 등)은 own row 가 아니라 각자 드래그 핸들을 가져야 하므로 own row 세로 범위에서 제외한다.
  // 첫 텍스트 블록(문단/헤딩)의 하단을 own row 의 바닥으로 본다. taskItem 은 체크박스+본문 div
  // 구조라 div 안의 첫 문단까지 함께 본다.
  const firstLine = listItemEl.querySelector(
    ":scope > p, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > div > p, :scope > div > h1, :scope > div > h2, :scope > div > h3",
  );
  const rowBottom =
    firstLine instanceof HTMLElement
      ? firstLine.getBoundingClientRect().bottom
      : itemRect.top + Math.min(itemRect.height, ROW_HEIGHT_FALLBACK_PX);

  return (
    clientX >= itemRect.left - GUTTER_LEFT_PX &&
    clientX <= itemRect.right + RECT_PAD_X &&
    clientY >= itemRect.top - 2 &&
    clientY <= rowBottom + 2
  );
}

function considerListItemHandleFromStack(
  editor: Editor,
  stack: Element[],
  byStart: Map<number, HoverInfo>,
  suppressedStarts: Set<number>,
  clientX: number,
  clientY: number,
) {
  const view = editor.view;
  const seen = new Set<HTMLElement>();
  for (const raw of stack) {
    if (!(raw instanceof HTMLElement)) continue;
    if (!view.dom.contains(raw)) continue;
    const listItemEl = raw.closest("li");
    if (!(listItemEl instanceof HTMLElement) || !view.dom.contains(listItemEl)) continue;
    if (seen.has(listItemEl)) continue;
    seen.add(listItemEl);
    if (!listItemOwnRowContainsPoint(listItemEl, clientX, clientY)) continue;
    const h = hoverFromListItemElement(editor, listItemEl);
    if (!h) continue;
    if (suppressedStarts.has(h.blockStart)) continue;
    const prev = byStart.get(h.blockStart);
    if (!prev || h.depth > prev.depth) byStart.set(h.blockStart, h);
    return;
  }
}

const ROW_HEIGHT_FALLBACK_PX = 28;

function collectListSuppressedOwnerStarts(
  editor: Editor,
  stack: Element[],
  clientX: number,
  clientY: number,
): Set<number> {
  const view = editor.view;
  const suppressed = new Set<number>();
  const seenLists = new Set<HTMLElement>();
  for (const raw of stack) {
    if (!(raw instanceof HTMLElement)) continue;
    if (!view.dom.contains(raw)) continue;
    let el: HTMLElement | null = raw;
    while (el && el !== view.dom) {
      if (el.matches("ul, ol")) {
        const listEl = el;
        if (!seenLists.has(listEl) && rectContainsPoint(listEl.getBoundingClientRect(), clientX, clientY)) {
          seenLists.add(listEl);
          let ownerLi = listEl.parentElement?.closest("li");
          while (ownerLi instanceof HTMLElement && view.dom.contains(ownerLi)) {
            const owner = hoverFromListItemElement(editor, ownerLi);
            if (owner) suppressed.add(owner.blockStart);
            ownerLi = ownerLi.parentElement?.closest("li") ?? null;
          }
        }
      }
      el = el.parentElement;
    }
  }
  return suppressed;
}

/** TD 등 React NodeView 내부에서 posAtDOM 이 막힐 때 — 래퍼 .qn-database-block 으로 직접 해석 */
function considerDatabaseBlockFromStack(
  editor: Editor,
  stack: Element[],
  considerPosition: (pos: number) => void,
) {
  const view = editor.view;
  for (const raw of stack) {
    if (!(raw instanceof HTMLElement)) continue;
    if (!view.dom.contains(raw)) continue;
    const db = raw.closest(".qn-database-block");
    if (!db || !view.dom.contains(db)) continue;
    try {
      considerPosition(view.posAtDOM(db, 0));
    } catch {
      try {
        considerPosition(view.posAtDOM(db, 1));
      } catch {
        /* noop */
      }
    }
  }
}

function considerContainerHandleFromStack(
  editor: Editor,
  stack: Element[],
  byStart: Map<number, HoverInfo>,
  clientX: number,
  clientY: number,
) {
  const view = editor.view;
  for (const raw of stack) {
    if (!(raw instanceof HTMLElement)) continue;
    if (!view.dom.contains(raw)) continue;
    const container =
      raw.closest("[data-column-layout]") ??
      raw.closest("[data-tab-block]");
    if (!(container instanceof HTMLElement) || !view.dom.contains(container)) continue;
    let pos: number | null = null;
    try {
      pos = view.posAtDOM(container, 0);
    } catch {
      try {
        pos = view.posAtDOM(container, 1);
      } catch {
        pos = null;
      }
    }
    if (pos == null) continue;
    const $pos = editor.state.doc.resolve(
      Math.min(Math.max(0, pos), editor.state.doc.content.size),
    );
    for (let d = $pos.depth; d > 0; d--) {
      const node = $pos.node(d);
      if (node.type.name !== "columnLayout" && node.type.name !== "tabBlock") continue;
      const start = $pos.before(d);
      const prev = byStart.get(start);
      const rect = container.getBoundingClientRect();
      // 컬럼/탭 컨테이너의 "본체" 핸들은 컨테이너 좌상단 모서리(작은 손잡이 영역)에서만 우선시한다.
      // 이전에는 48×32 영역이라 컬럼 첫 행 내부 블록 위에 호버해도 컨테이너 핸들이 강탈해
      // 안쪽 블록의 드래그 핸들이 잡히지 않던 회귀가 있었다.
      const nearTopLeft =
        clientX >= rect.left - 6 &&
        clientX <= rect.left + 12 &&
        clientY >= rect.top - 6 &&
        clientY <= rect.top + 12;
      const candidate: HoverInfo = {
        rect,
        blockStart: start,
        // 컨테이너 핸들은 좌상단 진입 구역에서만 우선, 그 외에는 내부 블럭 핸들을 유지.
        depth: nearTopLeft ? d + 10 : d - 1,
        node,
      };
      if (!prev || candidate.depth > prev.depth) byStart.set(start, candidate);
      break;
    }
  }
}

function considerTableHandleFromStack(
  editor: Editor,
  stack: Element[],
  byStart: Map<number, HoverInfo>,
) {
  const view = editor.view;
  for (const raw of stack) {
    if (!(raw instanceof HTMLElement)) continue;
    if (!view.dom.contains(raw)) continue;
    const tableEl = raw.closest("table");
    if (!(tableEl instanceof HTMLTableElement) || !view.dom.contains(tableEl)) continue;
    let pos: number | null = null;
    try {
      pos = view.posAtDOM(tableEl, 0);
    } catch {
      try {
        pos = view.posAtDOM(tableEl, 1);
      } catch {
        pos = null;
      }
    }
    if (pos == null) continue;
    const bounded = Math.min(Math.max(0, pos), editor.state.doc.content.size);
    const $pos = editor.state.doc.resolve(bounded);
    let found: HoverInfo | null = null;
    for (let d = $pos.depth; d >= 0; d--) {
      const node = $pos.node(d);
      if (node.type.name !== "table") continue;
      const start = d === 0 ? 0 : $pos.before(d);
      found = {
        rect: tableEl.getBoundingClientRect(),
        blockStart: start,
        depth: 1000,
        node,
      };
      break;
    }
    if (!found) continue;
    const prev = byStart.get(found.blockStart);
    if (!prev || found.depth > prev.depth) byStart.set(found.blockStart, found);
    return;
  }
}


/** 콜아웃·토글·인용 등 flatten 가능한 wrapper 의 "윗단 핸들 영역"에 커서가 있을 때,
 *  그 wrapper 자체를 byStart 후보로 등록한다.
 *
 *  hoverFromResolvedPos 는 ancestor 체인의 wrapper 들을 단 하나(가장 외곽)로 접어버리므로,
 *  콜아웃 안 콜아웃처럼 중첩된 경우 안쪽 wrapper 가 후보에서 통째로 빠져 그립이 안 붙었다.
 *  여기서는 각 wrapper 를 자기 top-zone(아래 컨테이너 게이트와 동일한 [top-8, top+triggerH])
 *  안에서만 등록하므로, 바깥 wrapper 상단을 호버하면 바깥이, 안쪽 wrapper 상단을 호버하면
 *  안쪽이 선택된다. N단계 중첩에도 일반화된다. */
function considerWrapperHandlesFromPos(
  editor: Editor,
  $pos: ResolvedPos,
  byStart: Map<number, HoverInfo>,
  clientX: number,
  clientY: number,
) {
  for (let d = $pos.depth; d > 0; d--) {
    const n = $pos.node(d);
    if (!n.isBlock || n.type.name === "doc") continue;
    if (shouldSuppressBlockHandle(n.type.name)) continue;
    if (!shouldFlattenWrapperBeforeTypeChange(n.type.name)) continue;
    const start = $pos.before(d);
    const dom = editor.view.nodeDOM(start);
    const el = dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null);
    if (!el) continue;
    const rectEl = visualElementForBlockNode(n.type.name, el);
    const rect = rectEl.getBoundingClientRect();
    // 아래 CONTAINER_TOP_HANDLE_TYPES 게이트와 동일한 상단 밴드 — 본문 영역에선 등록하지 않아
    // 내부 블록(문단·이미지 등)의 핸들을 가로채지 않는다.
    const triggerH = 40;
    if (clientY < rect.top - 8 || clientY > rect.top + triggerH) continue;
    // 가로 범위 밖(거터/우측 여백 제외) 이면 무시 — 다른 컬럼/형제로의 오인 방지
    if (clientX < rect.left - GUTTER_LEFT_PX || clientX > rect.right + RECT_PAD_X) continue;
    const candidate: HoverInfo = {
      rect,
      blockStart: start,
      // 깊을수록(안쪽 wrapper) 우선. 컨테이너/리스트 핸들과 충돌하지 않도록 큰 오프셋 부여.
      depth: d + 200,
      node: n,
    };
    const prev = byStart.get(start);
    if (!prev || candidate.depth > prev.depth) byStart.set(start, candidate);
  }
}

export function blockAtPoint(
  editor: Editor,
  clientX: number,
  clientY: number,
): HoverInfo | null {
  const view = editor.view;
  const byStart = new Map<number, HoverInfo>();
  let suppressedListStarts = new Set<number>();

  const considerPosition = (pos: number) => {
    let $pos: ResolvedPos;
    try {
      const max = editor.state.doc.content.size;
      $pos = editor.state.doc.resolve(Math.min(Math.max(0, pos), max));
    } catch (err) {
      reportNonFatal(err, "blockHandles.considerPosition.resolve");
      return;
    }
    // 중첩 wrapper(콜아웃 안 콜아웃 등) 의 상단 핸들 영역이면 그 wrapper 자체도 후보로 등록.
    // hoverFromResolvedPos 가 wrapper 를 외곽 하나로 접어버리는 한계를 보완한다.
    considerWrapperHandlesFromPos(editor, $pos, byStart, clientX, clientY);
    const h = hoverFromResolvedPos(editor, $pos);
    if (!h) return;
    if (suppressedListStarts.has(h.blockStart)) return;
    const prev = byStart.get(h.blockStart);
    if (!prev || h.depth > prev.depth) byStart.set(h.blockStart, h);
  };

  let stack: Element[] = [];
  try {
    stack = document.elementsFromPoint(clientX, clientY) as Element[];
  } catch (err) {
    reportNonFatal(err, "blockHandles.elementsFromPoint");
  }
  suppressedListStarts = collectListSuppressedOwnerStarts(editor, stack, clientX, clientY);

  considerDatabaseBlockFromStack(editor, stack, considerPosition);
  considerTableHandleFromStack(editor, stack, byStart);
  considerContainerHandleFromStack(editor, stack, byStart, clientX, clientY);
  considerListItemHandleFromStack(
    editor,
    stack,
    byStart,
    suppressedListStarts,
    clientX,
    clientY,
  );

  const coords = view.posAtCoords({ left: clientX, top: clientY });
  if (coords) considerPosition(coords.pos);

  for (const raw of stack) {
    if (!(raw instanceof HTMLElement)) continue;
    if (!view.dom.contains(raw)) continue;
    let el: HTMLElement | null = raw;
    let steps = 0;
    while (el && el !== view.dom && steps++ < 24) {
      try {
        const p = view.posAtDOM(el, 0);
        considerPosition(p);
        break;
      } catch (err) {
        reportNonFatal(err, "blockHandles.posAtDOM");
      }
      el = el.parentElement;
    }
  }

  if (byStart.size === 0) return null;
  let best: HoverInfo | null = null;
  for (const h of byStart.values()) {
    if (!best || h.depth > best.depth) best = h;
  }
  // listItem/taskItem: own row 에 있을 때만 핸들 표시 (gap 억제)
  if (best && isListHandleNodeType(best.node.type.name)) {
    if (!pointInsideListOwnRow(editor, best, clientX, clientY)) return null;
  }
  // 컨테이너 블록은 좌상단 영역 호버시에만 핸들 표시
  // — 내부 gap 을 지날 때 핸들이 깜빡이는 현상 방지
  const CONTAINER_TOP_HANDLE_TYPES = new Set([
    "table", "columnLayout", "tabBlock", "callout", "toggle", "blockquote",
  ]);
  if (best && CONTAINER_TOP_HANDLE_TYPES.has(best.node.type.name)) {
    const r = best.rect;
    const triggerH = best.node.type.name === "table" ? 28 : 40;
    if (clientY < r.top - 8 || clientY > r.top + triggerH) return null;
  }
  // 타이틀/input 등 NodeView 크롬 위에서는 깊은 블록보다 databaseBlock 을 우선
  for (const h of byStart.values()) {
    if (!shouldUseDatabaseBlockChrome(h.node.type.name)) continue;
    const dom = editor.view.nodeDOM(h.blockStart);
    const wrap =
      dom instanceof Element ? dom.closest(".qn-database-block") : null;
    if (!(wrap instanceof HTMLElement)) continue;
    const r = wrap.getBoundingClientRect();
    if (
      clientX >= r.left &&
      clientX <= r.right &&
      clientY >= r.top &&
      clientY <= r.bottom
    ) {
      return { ...h, rect: r };
    }
  }
  return best;
}

export const TOGGLE_VARIANT_MENU_ITEMS = [
  { label: "일반 토글", icon: ChevronRight, level: null },
  { label: "제목 1 토글", icon: Heading1, level: 1 as const },
  { label: "제목 2 토글", icon: Heading2, level: 2 as const },
  { label: "제목 3 토글", icon: Heading3, level: 3 as const },
];

export const TYPE_MENU_ITEMS = [
  { label: "본문", icon: Pilcrow, cmd: (e: Editor) => e.chain().focus().setParagraph().run() },
  { label: "제목 1", icon: Heading1, cmd: (e: Editor) => e.chain().focus().setHeading({ level: 1 }).run() },
  { label: "제목 2", icon: Heading2, cmd: (e: Editor) => e.chain().focus().setHeading({ level: 2 }).run() },
  { label: "제목 3", icon: Heading3, cmd: (e: Editor) => e.chain().focus().setHeading({ level: 3 }).run() },
  { label: "글머리 목록", icon: List, cmd: (e: Editor) => e.chain().focus().toggleBulletList().run() },
  { label: "번호 목록", icon: ListOrdered, cmd: (e: Editor) => e.chain().focus().toggleOrderedList().run() },
  { label: "할 일", icon: CheckSquare, cmd: (e: Editor) => e.chain().focus().toggleTaskList().run() },
  { label: "인용", icon: Quote, cmd: (e: Editor) => e.chain().focus().toggleBlockquote().run() },
  { label: "코드 블록", icon: Code2, cmd: (e: Editor) => e.chain().focus().toggleCodeBlock().run() },
  { label: "토글", icon: ChevronRight, cmd: (e: Editor) => e.chain().focus().setToggle().run() },
  { label: "콜아웃", icon: Lightbulb, cmd: (e: Editor) => e.chain().focus().setCallout("idea").run() },
];

// 에디터 뷰의 DOM 루트 — 파괴된 에디터/접근 실패 시 null.
export function getEditorViewDom(editor: Editor | null | undefined): Element | null {
  if (!editor || editor.isDestroyed) return null;
  try {
    return editor.view.dom;
  } catch {
    return null;
  }
}
