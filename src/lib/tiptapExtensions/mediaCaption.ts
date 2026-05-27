import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";

export type CaptionAlign = "left" | "center" | "right";

export const CAPTION_ALIGN_VALUES: CaptionAlign[] = ["left", "center", "right"];

export function nextCaptionAlign(current: unknown): CaptionAlign {
  const cur = typeof current === "string" ? current : "left";
  const idx = CAPTION_ALIGN_VALUES.indexOf(cur as CaptionAlign);
  return CAPTION_ALIGN_VALUES[(idx + 1) % CAPTION_ALIGN_VALUES.length] ?? "left";
}

export function focusCaptionInput(editor: Editor, pos: number): void {
  const focus = () => {
    const dom = editor.view.nodeDOM(pos);
    const el = dom instanceof HTMLElement ? dom : dom?.parentElement ?? null;
    const input = el?.querySelector<HTMLInputElement>("[data-qn-caption-input='true']");
    if (!input) return false;
    input.focus({ preventScroll: true });
    input.select();
    return true;
  };
  requestAnimationFrame(() => {
    if (focus()) return;
    window.setTimeout(focus, 30);
  });
}

export function toggleSelectedMediaCaption(
  editor: Editor,
  nodeTypes: string[],
): boolean {
  const sel = editor.state.selection;
  if (!(sel instanceof NodeSelection) || !nodeTypes.includes(sel.node.type.name)) return false;
  const attrs = sel.node.attrs as { caption?: string | null; captionAlign?: string | null };
  const nextCaption = typeof attrs.caption === "string" ? null : "";
  editor
    .chain()
    .setNodeSelection(sel.from)
    .updateAttributes(sel.node.type.name, {
      caption: nextCaption,
      ...(nextCaption === "" ? { captionAlign: attrs.captionAlign ?? "left" } : {}),
    })
    .run();
  if (nextCaption === "") focusCaptionInput(editor, sel.from);
  return true;
}
