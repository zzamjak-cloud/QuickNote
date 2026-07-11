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
  applyCaptionToggle(editor, sel.node.type.name, sel.from, attrs);
  return true;
}

/**
 * 캡션 토글 3단계 — 내용이 있는 캡션은 버튼 재클릭으로 지워지지 않는다(내용 보존):
 *  - 캡션 없음(null)      → 빈 캡션("") 생성 + 입력 포커스
 *  - 빈 캡션("")          → 캡션 제거(null)
 *  - 내용 있는 캡션("텍스트") → 제거하지 않고 기존 입력에 포커스만 이동
 * (기존 구현은 "문자열이면 무조건 null" 이라 내용 있는 캡션도 삭제돼 데이터가 유실됐다.)
 */
export function applyCaptionToggle(
  editor: Editor,
  nodeTypeName: string,
  from: number,
  attrs: { caption?: string | null; captionAlign?: string | null },
): void {
  const current = attrs.caption;
  const hasContent = typeof current === "string" && current.trim() !== "";
  if (hasContent) {
    // 내용 보존 — 삭제하지 않고 포커스만.
    focusCaptionInput(editor, from);
    return;
  }
  const nextCaption = typeof current === "string" ? null : "";
  editor
    .chain()
    .setNodeSelection(from)
    .updateAttributes(nodeTypeName, {
      caption: nextCaption,
      ...(nextCaption === "" ? { captionAlign: attrs.captionAlign ?? "left" } : {}),
    })
    .run();
  if (nextCaption === "") focusCaptionInput(editor, from);
}
