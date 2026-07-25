import type { Editor } from "@tiptap/react";

function setBlockId(editor: Editor, blockStart: number, id: string): string | null {
  const node = editor.state.doc.nodeAt(blockStart);
  if (!node) return null;
  editor.view.dispatch(
    editor.state.tr.setNodeMarkup(blockStart, undefined, {
      ...node.attrs,
      id,
    }),
  );
  return id;
}

/** 블록에 UniqueID 가 없으면 부여(댓글 스레드 앵커용) */
export function ensureBlockId(editor: Editor, blockStart: number): string | null {
  const node = editor.state.doc.nodeAt(blockStart);
  if (!node) return null;
  const existing = node.attrs.id as string | undefined;
  if (typeof existing === "string" && existing.length > 0) return existing;
  return setBlockId(editor, blockStart, crypto.randomUUID());
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

export function findBlockStartsById(editor: Editor, blockId: string): number[] {
  const found: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    const nid = node.attrs.id as string | undefined;
    if (nid === blockId) found.push(pos);
  });
  return found;
}

/**
 * 댓글·블럭 링크처럼 사용자가 "이 블럭"을 명시한 액션에서는 중복 id 후순위 블럭을
 * 그대로 쓰면 표시 로직의 첫 매칭 규칙 때문에 다른 블럭으로 붙는다.
 */
export function ensureCommentAnchorBlockId(
  editor: Editor,
  blockStart: number,
): string | null {
  const node = editor.state.doc.nodeAt(blockStart);
  if (!node) return null;
  const existing = node.attrs.id as string | undefined;
  if (typeof existing === "string" && existing.length > 0) {
    const starts = findBlockStartsById(editor, existing);
    if (starts.length <= 1 || starts[0] === blockStart) return existing;
  }
  return setBlockId(editor, blockStart, crypto.randomUUID());
}
