import type { Editor } from "@tiptap/react";

/** 블록에 UniqueID 가 없으면 부여(댓글 스레드 앵커용) */
export function ensureBlockId(editor: Editor, blockStart: number): string | null {
  const node = editor.state.doc.nodeAt(blockStart);
  if (!node) return null;
  const existing = node.attrs.id as string | undefined;
  if (typeof existing === "string" && existing.length > 0) return existing;
  const id = crypto.randomUUID();
  editor.view.dispatch(
    editor.state.tr.setNodeMarkup(blockStart, undefined, {
      ...node.attrs,
      id,
    }),
  );
  return id;
}

export function findBlockStartById(editor: Editor, blockId: string): number | null {
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    const nid = node.attrs.id as string | undefined;
    if (nid === blockId) {
      found = pos;
      return false;
    }
  });
  return found;
}
