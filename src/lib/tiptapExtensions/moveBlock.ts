import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { docTopLevelBlockStart } from "../pm/docTopLevelBlockStart";

/** 블록 내 가장 깊은 inline content 의 첫 위치(블록 시작 좌표 기준).
 *  bulletList → listItem → paragraph 처럼 nested 컨테이너인 경우에도 안전한 TextSelection 좌표를 만든다. */
function firstInlinePosInside(node: PMNode, blockStart: number): number | null {
  let pos = blockStart + 1; // 블록 안쪽 첫 위치
  let current: PMNode | null = node;
  // inline content (paragraph, heading, codeBlock 등) 까지 파고 든다.
  while (current && !current.inlineContent) {
    if (current.childCount === 0) return null; // atom (image, hr) — TextSelection 부적합
    const child: PMNode | null = current.firstChild;
    if (!child) return null;
    pos += 1; // 자식 노드의 open 토큰 통과
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

// 현재 선택의 최상위 블록 위치를 찾아 위/아래로 한 칸 이동.
// Cmd/Ctrl + Shift + ↑/↓ 단축키 바인딩.
export const MoveBlock = Extension.create({
  name: "moveBlock",

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-ArrowUp": ({ editor }) => moveBlock(editor, "up"),
      "Mod-Shift-ArrowDown": ({ editor }) => moveBlock(editor, "down"),
      // Shift+화살표 — 블록 단위로 확장하여 다중 블록 선택을 한 번의 키로 진입.
      // 코드 블록 안(line-by-line 텍스트 선택 필수)과 중첩($head.depth > 1, 콜아웃·토글 내부)은 PM 기본 동작 유지.
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
  // depth 1 = doc 직속 블록 내부. 그보다 깊으면 콜아웃·토글·컬럼 내부 → 기본 동작 위임.
  if ($head.depth !== 1) return false;
  const headBlockNode = $head.node(1);
  // 코드 블록 — 코드 작성 중 line-by-line 선택 필요. 기본 동작 유지.
  if (headBlockNode.type.name === "codeBlock") return false;

  const headBlockBefore = $head.before(1);
  const headBlockEnd = headBlockBefore + headBlockNode.nodeSize;

  let newHead: number | null;
  if (direction === "down") {
    if (headBlockEnd >= doc.content.size) return false; // 마지막 블록
    const nextStart = headBlockEnd;
    const nextNode = doc.nodeAt(nextStart);
    if (!nextNode) return false;
    // 다음 블록 안쪽 inline content 의 첫 위치. bulletList 처럼 nested 컨테이너도 안전.
    newHead = firstInlinePosInside(nextNode, nextStart);
  } else {
    if (headBlockBefore <= 0) return false; // 첫 블록
    let prevStart = -1;
    doc.forEach((node, fragmentOffset) => {
      const blockStart = docTopLevelBlockStart(fragmentOffset);
      if (blockStart + node.nodeSize === headBlockBefore) prevStart = blockStart;
    });
    if (prevStart < 0) return false;
    const prevNode = doc.nodeAt(prevStart);
    if (!prevNode) return false;
    // 직전 블록 안쪽 inline content 의 마지막 위치.
    newHead = lastInlinePosInside(prevNode, prevStart);
  }
  // atom 또는 inline content 가 없는 블록 → TextSelection 부적합. 기본 동작 위임.
  if (newHead === null) return false;

  try {
    const tr = state.tr.setSelection(
      TextSelection.create(doc, selection.anchor, newHead),
    );
    editor.view.dispatch(tr.scrollIntoView());
    return true;
  } catch {
    return false;
  }
}

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
