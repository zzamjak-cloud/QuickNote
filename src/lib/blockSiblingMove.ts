import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Fragment } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";

/**
 * 블록 시작 위치·깊이 기준으로 같은 부모 안에서 인접 형제와 자리를 바꾼다.
 * 컬럼 내부 문단 등 중첩 블록에서도 동작한다.
 */
export function moveAdjacentSiblingBlock(
  editor: Editor,
  blockStart: number,
  blockDepth: number,
  dir: "up" | "down",
): boolean {
  const { state } = editor;
  const { doc } = state;
  const safe = Math.min(
    Math.max(blockStart + 1, 1),
    doc.content.size - 1,
  );
  const $p = doc.resolve(safe);

  const parentDepth = blockDepth - 1;
  if (parentDepth < 0) return false;

  const parent = $p.node(parentDepth);
  const idx = $p.index(parentDepth);
  const swapIdx = dir === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= parent.childCount) return false;

  const children: PMNode[] = [];
  for (let i = 0; i < parent.childCount; i++) {
    children.push(parent.child(i));
  }
  const t = children[idx];
  children[idx] = children[swapIdx]!;
  children[swapIdx] = t!;

  const newParent = parent.copy(Fragment.from(children));
  const from = $p.before(parentDepth);
  const to = from + parent.nodeSize;

  let tr = state.tr.replaceWith(from, to, newParent);
  const mappedStart = tr.mapping.map(blockStart);
  try {
    const res = tr.doc.resolve(mappedStart + 1);
    tr = tr.setSelection(TextSelection.near(res));
  } catch {
    /* ignore */
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}
