import { Extension } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { topLevelBlockStartEndingAt } from "../pm/topLevelBlocks";
import { reportNonFatal } from "../reportNonFatal";

/** 블록 내 가장 깊은 inline content 의 첫 위치(블록 시작 좌표 기준). */
function firstInlinePosInside(node: PMNode, blockStart: number): number | null {
  let pos = blockStart + 1;
  let current: PMNode | null = node;
  while (current && !current.inlineContent) {
    if (current.childCount === 0) return null;
    const child: PMNode | null = current.firstChild;
    if (!child) return null;
    pos += 1;
    current = child;
  }
  return pos;
}

/** 블록 내 가장 깊은 inline content 의 마지막 위치(블록 끝 close 토큰 직전). */
function lastInlinePosInside(node: PMNode, blockStart: number): number | null {
  let pos = blockStart + node.nodeSize - 1;
  let current: PMNode | null = node;
  while (current && !current.inlineContent) {
    if (current.childCount === 0) return null;
    const child: PMNode | null = current.lastChild;
    if (!child) return null;
    pos -= 1;
    current = child;
  }
  return pos;
}

type BlockMoveContext = {
  parentPos: number;
  parent: PMNode;
  index: number;
};

/** 형제 블록끼리 순서 교환 가능한 컨테이너인지 (토글 헤더/열·탭 패널 래퍼 등은 제외) */
function parentAllowsSiblingReorder(parent: PMNode, child: PMNode): boolean {
  if (parent.childCount < 2) return false;
  const p = parent.type.name;
  const c = child.type.name;
  if (c === "toggleHeader") return false;
  if (p === "toggle") return false;
  if (p === "columnLayout" && c === "column") return false;
  if (p === "tabBlock" && c === "tabPanel") return false;
  if (p === "table" || p === "tableRow" || p === "tableCell" || c === "tableCell") {
    return false;
  }
  return true;
}

/** 커서 기준으로 한 칸 위/아래로 옮길 블록과 그 부모 컨테이너 */
function findBlockMoveContext(state: EditorState): BlockMoveContext | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d);
    if (!node.isBlock) continue;
    const parent = $from.node(d - 1);
    if (!parentAllowsSiblingReorder(parent, node)) continue;
    return {
      parentPos: $from.before(d - 1),
      parent,
      index: $from.index(d),
    };
  }
  return null;
}

function selectionPosAfterSwap(
  tr: Transaction,
  parentPos: number,
  children: PMNode[],
  targetIndex: number,
): void {
  let offset = parentPos + 1;
  for (let i = 0; i < targetIndex; i++) offset += children[i]!.nodeSize;
  const movedNode = children[targetIndex]!;
  const inlinePos = firstInlinePosInside(movedNode, offset);
  if (inlinePos != null) {
    tr.setSelection(TextSelection.near(tr.doc.resolve(inlinePos)));
    return;
  }
  try {
    tr.setSelection(NodeSelection.create(tr.doc, offset));
  } catch (err) {
    reportNonFatal(err, "moveBlock.selectionAfterSwap");
    tr.setSelection(TextSelection.near(tr.doc.resolve(offset + 1)));
  }
}

function moveBlock(
  editor: { state: EditorState; view: { dispatch: (tr: Transaction) => void } },
  direction: "up" | "down",
): boolean {
  const ctx = findBlockMoveContext(editor.state);
  if (!ctx) return false;

  const { parentPos, parent, index } = ctx;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= parent.childCount) return false;

  const children: PMNode[] = [];
  parent.forEach((child) => children.push(child));

  const newChildren = [...children];
  [newChildren[index], newChildren[targetIndex]] = [
    newChildren[targetIndex]!,
    newChildren[index]!,
  ];

  const newParent = parent.type.create(parent.attrs, newChildren);
  const tr = editor.state.tr.replaceWith(
    parentPos,
    parentPos + parent.nodeSize,
    newParent,
  );
  selectionPosAfterSwap(tr, parentPos, newChildren, targetIndex);
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

// 블록 위/아래 한 칸 이동 — doc 직속·콜아웃·토글 본문·탭 패널·컬럼·목록 등 동일 부모 형제 기준.
export const MoveBlock = Extension.create({
  name: "moveBlock",

  addKeyboardShortcuts() {
    return {
      "Mod-Alt-ArrowUp": ({ editor }) => moveBlock(editor, "up"),
      "Mod-Alt-ArrowDown": ({ editor }) => moveBlock(editor, "down"),
      "Mod-Shift-ArrowUp": ({ editor }) => moveBlock(editor, "up"),
      "Mod-Shift-ArrowDown": ({ editor }) => moveBlock(editor, "down"),
      "Shift-ArrowDown": ({ editor }) => extendBlockSelection(editor, "down"),
      "Shift-ArrowUp": ({ editor }) => extendBlockSelection(editor, "up"),
    };
  },
});

function extendBlockSelection(
  editor: { state: EditorState; view: { dispatch: (tr: Transaction) => void } },
  direction: "down" | "up",
): boolean {
  const { state } = editor;
  const { selection, doc } = state;
  const $head = doc.resolve(selection.head);
  if ($head.depth !== 1) return false;
  const headBlockNode = $head.node(1);
  if (headBlockNode.type.name === "codeBlock") return false;

  const headBlockBefore = $head.before(1);
  const headBlockEnd = headBlockBefore + headBlockNode.nodeSize;

  let newHead: number | null;
  if (direction === "down") {
    if (headBlockEnd >= doc.content.size) return false;
    const nextStart = headBlockEnd;
    const nextNode = doc.nodeAt(nextStart);
    if (!nextNode) return false;
    newHead = firstInlinePosInside(nextNode, nextStart);
  } else {
    if (headBlockBefore <= 0) return false;
    const prevStart = topLevelBlockStartEndingAt(doc, headBlockBefore);
    if (prevStart === null) return false;
    const prevNode = doc.nodeAt(prevStart);
    if (!prevNode) return false;
    newHead = lastInlinePosInside(prevNode, prevStart);
  }
  if (newHead === null) return false;

  try {
    const tr = state.tr.setSelection(
      TextSelection.create(doc, selection.anchor, newHead),
    );
    editor.view.dispatch(tr.scrollIntoView());
    return true;
  } catch (err) {
    reportNonFatal(err, "moveBlock.extendBlockSelection");
    return false;
  }
}
