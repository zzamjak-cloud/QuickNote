import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

/** nodeDOM / domAtPos 결과에서 tabPanel 래퍼 요소 찾기 */
function shellFromNodeDom(dom: globalThis.Node | null): HTMLElement | null {
  if (!dom) return null;
  if (dom instanceof HTMLElement) {
    return dom.hasAttribute("data-tab-panel")
      ? dom
      : dom.closest("[data-tab-panel]");
  }
  return dom.parentElement?.closest?.("[data-tab-panel]") ?? null;
}

function panelShellFromDocPos(view: EditorView, childPos: number): HTMLElement | null {
  const raw = view.nodeDOM(childPos);
  let shell = shellFromNodeDom(raw);
  if (shell) return shell;

  try {
    const at = view.domAtPos(childPos);
    let n: globalThis.Node = at.node;
    if (n.nodeType === 3 && n.parentElement) {
      n = n.parentElement;
    }
    if (n instanceof HTMLElement) {
      shell = n.closest("[data-tab-panel]");
      if (shell) return shell;
    }
  } catch {
    /* domAtPos 실패 시 null */
  }
  return null;
}

/**
 * 문서 순서대로 tabPanel 래퍼 DOM 수집.
 * `nodeDOM(pos)`+`closest`만 쓰면 잘못된 pos에서 같은 패널이 반복되는 경우가 있어
 * `tabBlock.forEach` 의 fragment offset 으로 정확한 childPos 를 쓴다.
 */
export function tabPanelElementsFromDocOrder(
  view: EditorView,
  blockPos: number,
  tabBlock: PMNode,
): HTMLElement[] {
  const out: HTMLElement[] = [];
  tabBlock.forEach((child, offset) => {
    if (child.type.name !== "tabPanel") return;
    const childPos = blockPos + 1 + offset;
    const shell = panelShellFromDocPos(view, childPos);
    if (shell) out.push(shell);
  });
  return out;
}

function panelsAreUnique(elements: HTMLElement[]): boolean {
  return new Set(elements).size === elements.length;
}

/**
 * 문서 좌표 기반 수집이 실패(중복 참조·개수 불일치)하면 `.qn-tab-panels` 아래 DOM 순서로 폴백
 */
export function pickTabPanelShells(
  view: EditorView,
  blockPos: number,
  tabBlock: PMNode,
  panelsRoot: Element | null,
): HTMLElement[] {
  const expect = tabBlock.childCount;
  const fromDoc = tabPanelElementsFromDocOrder(view, blockPos, tabBlock);
  const docUsable = fromDoc.length === expect && panelsAreUnique(fromDoc);

  if (docUsable) {
    return fromDoc;
  }

  if (panelsRoot) {
    const fromDom = queryTabPanelElements(panelsRoot);
    const domOk = fromDom.length === expect && panelsAreUnique(fromDom);
    if (domOk) {
      return fromDom;
    }
    if (fromDom.length >= fromDoc.length && fromDom.length > 0) {
      return fromDom;
    }
  }

  const fallback =
    fromDoc.length > 0 ? fromDoc : panelsRoot ? queryTabPanelElements(panelsRoot) : [];
  return fallback;
}

/**
 * TipTap React 노드뷰는 contentDOM 래퍼 때문에 `[data-tab-panel]` 이 `.qn-tab-panels` 직계가 아닐 수 있다.
 */
export function queryTabPanelElements(panelsRoot: Element): HTMLElement[] {
  const direct = [
    ...panelsRoot.querySelectorAll(":scope > [data-tab-panel]"),
  ] as HTMLElement[];
  if (direct.length > 0) return direct;

  for (const child of panelsRoot.children) {
    const nested = [
      ...child.querySelectorAll(":scope > [data-tab-panel]"),
    ] as HTMLElement[];
    if (nested.length > 0) return nested;
    for (const grand of child.children) {
      const deep = [
        ...grand.querySelectorAll(":scope > [data-tab-panel]"),
      ] as HTMLElement[];
      if (deep.length > 0) return deep;
    }
  }

  const first = panelsRoot.querySelector("[data-tab-panel]");
  if (!first || !(first instanceof HTMLElement)) return [];

  const parent = first.parentElement;
  if (!parent || !panelsRoot.contains(parent)) {
    return [first];
  }

  const siblings = [...parent.children].filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement && el.hasAttribute("data-tab-panel"),
  );
  return siblings.length > 0 ? siblings : [first];
}
