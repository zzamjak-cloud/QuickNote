import type { Editor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import { forEachDocDirectBlock } from "../../lib/pm/topLevelBlocks";
import { reportNonFatal } from "../../lib/reportNonFatal";
import { GROUP_OVERLAY_ID } from "./constants";

/** React NodeView(databaseBlock) — 공통 blockOuterEl 상향이 테이블 셀 등에서 끊기면 마퀴·드래그 미리보기가 실패한다 */
function pmRootChildForDatabaseBlock(
  view: EditorView,
  blockStart: number,
  root: HTMLElement,
): HTMLElement | null {
  let n: Node | null = view.nodeDOM(blockStart);
  if (!n) {
    const innerMax = view.state.doc.content.size;
    const probe = Math.min(Math.max(1, blockStart + 1), innerMax);
    try {
      const domAt = view.domAtPos(probe);
      n = domAt.node as Node;
      if (n.nodeType === Node.TEXT_NODE) n = n.parentElement;
    } catch (err) {
      reportNonFatal(err, "boxSelect.pmRootChildForDatabaseBlock.probe");
      return null;
    }
  }
  if (!n) return null;
  if (n.nodeType === Node.TEXT_NODE) n = n.parentElement;
  if (!n) return null;
  const anchor =
    n instanceof Element
      ? n.closest(".qn-database-block") ??
        n.closest("[data-node-view-wrapper]")
      : null;
  let el: HTMLElement | null =
    anchor instanceof HTMLElement ? anchor : null;
  while (el && el !== root) {
    if (el.parentElement === root) return el;
    el = el.parentElement;
  }
  return null;
}

/** 파괴된 뒤 `editor.view` 접근 시 TipTap 이 throw 하므로 선행 검사 */
export function editorViewAvailable(editor: Editor | null): editor is Editor {
  return Boolean(editor && !editor.isDestroyed);
}

/** 박스 선택 오버레이를 붙일 호스트 — 스크롤 영역 안에 두어 contains()·히트 테스트가 깨지지 않게 함 */
export function getEditorMarqueeHost(editor: Editor): HTMLElement {
  if (!editorViewAvailable(editor)) {
    return document.body;
  }
  const columnHost =
    editor.view.dom.closest<HTMLElement>("[data-qn-editor-column]") ??
    editor.view.dom.parentElement;
  return (
    editor.view.dom.closest<HTMLElement>(".overflow-y-auto") ??
    columnHost ??
    document.body
  );
}

/** nodeDOM이 텍스트/인라인을 줄 때까지 올라가 ProseMirror 직계 자식(최상위 블록 행)만 반환 */
export function blockOuterEl(editor: Editor, blockStart: number): HTMLElement | null {
  if (!editorViewAvailable(editor)) return null;
  const view = editor.view;
  const root = view.dom;
  const pmNode = view.state.doc.nodeAt(blockStart);
  if (pmNode?.type.name === "databaseBlock") {
    const dbEl = pmRootChildForDatabaseBlock(view, blockStart, root);
    if (dbEl) return dbEl;
  }

  let n: Node | null = view.nodeDOM(blockStart);
  if (!n) {
    const innerMax = view.state.doc.content.size;
    const probe = Math.min(Math.max(1, blockStart + 1), innerMax);
    try {
      const domAt = view.domAtPos(probe);
      n = domAt.node as Node;
      if (n.nodeType === Node.TEXT_NODE) n = n.parentElement;
    } catch (err) {
      reportNonFatal(err, "boxSelect.blockOuterEl.probe");
      return null;
    }
  }
  if (!n) return null;
  if (n.nodeType === Node.TEXT_NODE) n = n.parentElement;
  if (!n) return null;
  let el: HTMLElement | null =
    n instanceof HTMLElement ? n : (n as Node).parentElement;
  while (el && el !== root) {
    if (el.parentElement === root) return el;
    el = el.parentElement;
  }
  return null;
}

/** 문서 직속 블록 목록 */
export function getTopLevelBlocks(editor: Editor): { el: HTMLElement; pos: number }[] {
  const result: { el: HTMLElement; pos: number }[] = [];
  const { doc } = editor.state;
  forEachDocDirectBlock(doc, (_node, blockStart) => {
    const el = blockOuterEl(editor, blockStart);
    if (el) result.push({ el, pos: blockStart });
  });
  return result;
}

/**
 * 단일 그룹 오버레이 — 선택된 블록들의 union 바운딩 박스 위에 라운딩된 사각형을 그린다.
 * PM DOM 에는 일절 손대지 않으므로 PM view.update 가 노드를 재렌더해도 영향 없음.
 */
export function ensureGroupOverlay(editor: Editor): HTMLDivElement {
  const host = getEditorMarqueeHost(editor);
  const misplaced = document.getElementById(GROUP_OVERLAY_ID);
  if (misplaced && misplaced.parentElement !== host) {
    misplaced.remove();
  }
  let ov = host.querySelector<HTMLDivElement>(`#${GROUP_OVERLAY_ID}`);
  if (ov) return ov;
  ov = document.createElement("div");
  ov.id = GROUP_OVERLAY_ID;
  // 노션처럼 시각 표시만 — pointer-events: none 으로 클릭 통과, 이동은 그립 핸들러 전용
  ov.style.cssText =
    [
      "position: fixed",
      "pointer-events: none",
      "z-index: 30",
      "border-radius: 8px",
      "background-color: rgba(35, 131, 226, 0.18)",
      "box-shadow: 0 0 0 2px rgba(35, 131, 226, 0.7)",
      "display: none",
      "transition: none",
    ].join("; ") + ";";
  ov.setAttribute("aria-hidden", "true");
  host.appendChild(ov);
  return ov;
}

export function hideGroupOverlay(editor: Editor | null): void {
  if (!editorViewAvailable(editor)) {
    const ov = document.getElementById(GROUP_OVERLAY_ID);
    if (ov) ov.style.display = "none";
    return;
  }
  const el = getEditorMarqueeHost(editor).querySelector<HTMLElement>(
    `#${GROUP_OVERLAY_ID}`,
  );
  const ov = el ?? document.getElementById(GROUP_OVERLAY_ID);
  if (ov) ov.style.display = "none";
}

export function showGroupOverlayForRects(editor: Editor, rects: DOMRect[]): void {
  if (rects.length === 0) {
    hideGroupOverlay(editor);
    return;
  }
  const ov = ensureGroupOverlay(editor);
  let minLeft = Infinity;
  let minTop = Infinity;
  let maxRight = -Infinity;
  let maxBottom = -Infinity;
  rects.forEach((r) => {
    if (r.left < minLeft) minLeft = r.left;
    if (r.top < minTop) minTop = r.top;
    if (r.right > maxRight) maxRight = r.right;
    if (r.bottom > maxBottom) maxBottom = r.bottom;
  });
  const PAD = 4;
  ov.style.display = "block";
  ov.style.left = `${minLeft - PAD}px`;
  ov.style.top = `${minTop - PAD}px`;
  ov.style.width = `${maxRight - minLeft + PAD * 2}px`;
  ov.style.height = `${maxBottom - minTop + PAD * 2}px`;
}

/** pos 들을 받아 현재 DOM 좌표로 계산해 그룹 오버레이를 갱신 */
export function paintOverlayForPositions(editor: Editor, positions: number[]): void {
  if (positions.length === 0) {
    hideGroupOverlay(editor);
    return;
  }
  const rects: DOMRect[] = [];
  positions.forEach((pos) => {
    const el = blockOuterEl(editor, pos);
    if (el) rects.push(el.getBoundingClientRect());
  });
  showGroupOverlayForRects(editor, rects);
}
