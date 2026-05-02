import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";

// 현재 선택의 최상위 블록 위치를 찾아 위/아래로 한 칸 이동.
// Cmd/Ctrl + Shift + ↑/↓ 단축키 바인딩.
export const MoveBlock = Extension.create({
  name: "moveBlock",

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-ArrowUp": ({ editor }) => moveBlock(editor, "up"),
      "Mod-Shift-ArrowDown": ({ editor }) => moveBlock(editor, "down"),
    };
  },
});

function findTopLevelBlockPos(state: EditorState): {
  pos: number;
  size: number;
  index: number;
} | null {
  const { $from } = state.selection;
  // depth 1 = doc 직속 블록
  if ($from.depth < 1) return null;
  const pos = $from.before(1);
  const node = state.doc.child($from.index(0));
  return {
    pos,
    size: node.nodeSize,
    index: $from.index(0),
  };
}

function moveBlock(editor: { state: EditorState; view: { dispatch: (tr: Transaction) => void } }, direction: "up" | "down"): boolean {
  const info = findTopLevelBlockPos(editor.state);
  if (!info) return false;
  const { state } = editor;
  const { doc } = state;
  const childCount = doc.childCount;
  const targetIndex = direction === "up" ? info.index - 1 : info.index + 1;
  if (targetIndex < 0 || targetIndex >= childCount) return false;

  const currentNode = doc.child(info.index);
  const otherNode = doc.child(targetIndex);

  let tr = state.tr;
  if (direction === "up") {
    const otherPos = info.pos - otherNode.nodeSize;
    tr = tr.replaceWith(
      otherPos,
      info.pos + currentNode.nodeSize,
      [currentNode, otherNode],
    );
    // 커서를 이동한 노드 안의 처음으로 옮김
    const newSelectionPos = otherPos + 1;
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(newSelectionPos)));
  } else {
    const endPos = info.pos + currentNode.nodeSize + otherNode.nodeSize;
    tr = tr.replaceWith(info.pos, endPos, [otherNode, currentNode]);
    const newSelectionPos = info.pos + otherNode.nodeSize + 1;
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(newSelectionPos)));
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}
