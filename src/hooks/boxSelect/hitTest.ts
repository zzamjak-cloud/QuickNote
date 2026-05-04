import type { Editor } from "@tiptap/react";
import { GROUP_OVERLAY_ID } from "./constants";

/** 본문 PM 바깥이지만 스크롤 에디터 안 — 좌우 전체 너비 여백 등. 마퀴 허용하되 페이지 크롬은 제외 */
export function isEditorChromeOutsidePm(el: Element): boolean {
  return Boolean(
    el.closest(
      [
        "input",
        "textarea",
        "select",
        "button",
        "a[href]",
        "[data-qn-block-grip]",
        ".tippy-box",
        "[role='menu']",
        "[role='listbox']",
        "[role='dialog']",
      ].join(", "),
    ),
  );
}

export function shouldIgnoreBoxSelectStart(
  editor: Editor,
  editorHost: HTMLElement,
  target: Element,
): boolean {
  if (!editor.view.dom.contains(target)) return true;
  if (!editorHost.contains(target)) return true;
  if (target.closest("[data-qn-block-grip]")) return true;
  const inDbBlock = target.closest(".qn-database-block");
  if (inDbBlock) {
    if (target.closest("input, textarea, select")) return true;
    if (target.closest("button")) return true;
    return false;
  }
  if (target.closest("input, textarea, select")) return true;
  if (
    target.closest("a[href]") &&
    !target.closest(".qn-database-block")
  ) {
    return true;
  }
  if (target.closest("button") && !editor.view.dom.contains(target))
    return true;
  if (target.closest(".tippy-box, [role='menu'], [role='listbox']")) return true;
  return false;
}

export function isGroupOverlayTarget(target: Element): boolean {
  return Boolean(target.closest(`#${GROUP_OVERLAY_ID}`));
}
