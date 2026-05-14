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

/** wrapper(콜아웃·토글·인용) 블록을 그 안의 텍스트만 담은 단일 paragraph로 치환.
 *  치환 성공 시 true 반환 — 호출자는 이후 setHeading 등 단일 타입 명령을 적용한다. */
export function flattenWrapperToParagraph(editor: Editor, blockStart: number): boolean {
  const node = editor.state.doc.nodeAt(blockStart);
  if (!node || !shouldFlattenWrapperBeforeTypeChange(node.type.name)) return false;
  const paragraphType = editor.schema.nodes.paragraph;
  if (!paragraphType) return false;
  let text = "";
  node.descendants((n) => {
    if (n.isText) text += n.text;
    return true;
  });
  const paragraph = paragraphType.create(
    null,
    text ? editor.schema.text(text) : null,
  );
  editor.view.dispatch(
    editor.state.tr.replaceWith(blockStart, blockStart + node.nodeSize, paragraph),
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
  const top = hover.rect.top - wrapperRect.top + HANDLE_TOP_OFFSET_PX;
  const rawLeft = hover.rect.left - wrapperRect.left - HANDLE_STRIP_PX;
  const left = Math.max(MIN_HANDLE_LEFT, rawLeft);
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
    const rectEl =
      shouldUseDatabaseBlockChrome(n.type.name)
        ? el.closest(".qn-database-block") ?? el
        : el;
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
  // doc 직속 atom 블록(databaseBlock 등)은 $pos.depth == 0 이라 위 루프가 잡지 못함.
  // posAtCoords/posAtDOM 결과가 atom 경계에 떨어지므로 nodeAfter/nodeBefore 모두 검사.
  if (!inner && $pos.parent.type.name === "doc") {
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
      const rectEl =
        shouldUseDatabaseBlockChrome(n.type.name)
          ? el.closest(".qn-database-block") ?? el
          : el;
      inner = {
        rect: rectEl.getBoundingClientRect(),
        blockStart: p.start,
        depth: 1, // doc 직속 → top-level paragraph 와 동일 우선순위
        node: n,
      };
      break;
    }
  }
  return taskItem ?? listItem ?? inner ?? wrapper;
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

export function blockAtPoint(
  editor: Editor,
  clientX: number,
  clientY: number,
): HoverInfo | null {
  const view = editor.view;
  const byStart = new Map<number, HoverInfo>();

  const considerPosition = (pos: number) => {
    let $pos: ResolvedPos;
    try {
      const max = editor.state.doc.content.size;
      $pos = editor.state.doc.resolve(Math.min(Math.max(0, pos), max));
    } catch (err) {
      reportNonFatal(err, "blockHandles.considerPosition.resolve");
      return;
    }
    const h = hoverFromResolvedPos(editor, $pos);
    if (!h) return;
    const prev = byStart.get(h.blockStart);
    if (!prev || h.depth > prev.depth) byStart.set(h.blockStart, h);
  };

  let stack: Element[] = [];
  try {
    stack = document.elementsFromPoint(clientX, clientY) as Element[];
  } catch (err) {
    reportNonFatal(err, "blockHandles.elementsFromPoint");
  }

  considerDatabaseBlockFromStack(editor, stack, considerPosition);

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

export const TYPE_MENU_ITEMS = [
  { label: "본문", icon: Pilcrow, cmd: (e: Editor) => e.chain().focus().setParagraph().run() },
  { label: "제목 1", icon: Heading1, cmd: (e: Editor) => e.chain().focus().setHeading({ level: 1 }).run() },
  { label: "제목 2", icon: Heading2, cmd: (e: Editor) => e.chain().focus().setHeading({ level: 2 }).run() },
  { label: "제목 3", icon: Heading3, cmd: (e: Editor) => e.chain().focus().setHeading({ level: 3 }).run() },
  { label: "글머리 목록", icon: List, cmd: (e: Editor) => e.chain().focus().toggleBulletList().run() },
  { label: "할 일", icon: CheckSquare, cmd: (e: Editor) => e.chain().focus().toggleTaskList().run() },
  { label: "인용", icon: Quote, cmd: (e: Editor) => e.chain().focus().toggleBlockquote().run() },
  { label: "코드 블록", icon: Code2, cmd: (e: Editor) => e.chain().focus().toggleCodeBlock().run() },
  { label: "토글", icon: ChevronRight, cmd: (e: Editor) => e.chain().focus().setToggle().run() },
  { label: "콜아웃", icon: Lightbulb, cmd: (e: Editor) => e.chain().focus().setCallout("idea").run() },
];
