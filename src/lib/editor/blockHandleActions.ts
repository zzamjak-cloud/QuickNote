import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";

const LIST_ITEM_TYPES = new Set(["listItem", "taskItem"]);

type DeleteRange = { from: number; to: number };

/** 드래그 핸들로 가리킨 텍스트 블록 전체의 굵게 상태를 토글한다. */
export function toggleBlockBold(editor: Editor, blockStart: number): boolean {
  const node = editor.state.doc.nodeAt(blockStart);
  if (!node?.isTextblock) return false;

  const from = blockStart + 1;
  const to = from + node.content.size;
  return editor
    .chain()
    .focus()
    .setTextSelection({ from, to })
    .toggleBold()
    .run();
}

/**
 * 드래그 핸들이 가리킨 블록을 제거한다.
 *
 * 단독 listItem만 삭제하면 ProseMirror가 `listItem+` 스키마를 맞추기 위해 빈 항목을
 * 다시 만들 수 있다. 이 경우에는 항목을 감싼 목록 컨테이너까지 제거한다.
 */
export function deleteBlockFromHandle(editor: Editor, blockStart: number): boolean {
  const { doc } = editor.state;
  const node = doc.nodeAt(blockStart);
  if (!node) return false;

  const range = LIST_ITEM_TYPES.has(node.type.name)
    ? resolveListItemDeleteRange(doc, blockStart)
    : null;
  const effectiveRange = range ?? {
    from: blockStart,
    to: blockStart + node.nodeSize,
  };
  return applyDeleteRange(editor, effectiveRange);
}

/** native 그립 드래그가 남긴 NodeSelection이 목록 항목이면 같은 행 삭제 규칙을 적용한다. */
export function deleteListItemNodeSelection(
  editor: Editor,
  blockStart: number,
): boolean {
  const selectedNode = editor.state.doc.nodeAt(blockStart);
  if (!selectedNode || !LIST_ITEM_TYPES.has(selectedNode.type.name)) return false;
  const range = resolveListItemDeleteRange(editor.state.doc, blockStart);
  return range ? applyDeleteRange(editor, range) : false;
}

function resolveListItemDeleteRange(doc: PMNode, blockStart: number): DeleteRange | null {
  if (!doc.nodeAt(blockStart)) return null;
  const safeInside = Math.min(blockStart + 1, doc.content.size);
  const $inside = doc.resolve(safeInside);

  for (let depth = $inside.depth; depth >= 1; depth -= 1) {
    const ancestor = $inside.node(depth);
    if (!LIST_ITEM_TYPES.has(ancestor.type.name) || depth < 2) continue;

    const list = $inside.node(depth - 1);
    const itemStart = $inside.before(depth);
    if (list.childCount > 1) {
      return { from: itemStart, to: itemStart + ancestor.nodeSize };
    }
    const listStart = $inside.before(depth - 1);
    return { from: listStart, to: listStart + list.nodeSize };
  }
  return null;
}

function applyDeleteRange(editor: Editor, range: DeleteRange): boolean {
  let tr = editor.state.tr.delete(range.from, range.to);
  if (!tr.docChanged) return false;

  const selectionPos = Math.min(range.from, tr.doc.content.size);
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(selectionPos), -1));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}
