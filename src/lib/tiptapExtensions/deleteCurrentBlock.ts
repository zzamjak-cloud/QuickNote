import { Extension } from "@tiptap/core";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";

type DeleteTarget = {
  from: number;
  to: number;
  replaceWithParagraph: boolean;
};

const LIST_ITEM_TYPES = new Set(["listItem", "taskItem"]);
const DIRECT_PARENT_TYPES = new Set(["doc", "column"]);
const PROTECTED_TYPES = new Set(["columnLayout", "column"]);

export const DeleteCurrentBlock = Extension.create({
  name: "deleteCurrentBlock",
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      "Mod-Backspace": ({ editor }) => deleteCurrentBlock(editor),
      "Mod-Delete": ({ editor }) => deleteCurrentBlock(editor),
    };
  },
});

function deleteCurrentBlock(editor: {
  state: EditorState;
  view: { dispatch: (tr: Transaction) => void; focus: () => void };
  schema: { nodes: Record<string, PMNode["type"] | undefined> };
}): boolean {
  const { state } = editor;
  if (!state.selection.empty) return false;

  const target = findDeleteTarget(state);
  if (!target) return false;

  const paragraphType = editor.schema.nodes.paragraph;
  if (target.replaceWithParagraph && !paragraphType) return false;

  let tr = state.tr;
  if (target.replaceWithParagraph && paragraphType) {
    tr = tr.replaceWith(target.from, target.to, paragraphType.create());
  } else {
    tr = tr.delete(target.from, target.to);
  }

  const selectionPos = Math.min(target.from + 1, tr.doc.content.size);
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(selectionPos), -1));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}

function findDeleteTarget(state: EditorState): DeleteTarget | null {
  const { $from } = state.selection;
  return findListItemTarget($from) ?? findDirectBlockTarget($from);
}

function findListItemTarget($from: ResolvedPos): DeleteTarget | null {
  for (let depth = $from.depth; depth >= 1; depth--) {
    const node = $from.node(depth);
    if (!LIST_ITEM_TYPES.has(node.type.name)) continue;
    if (depth < 2) return null;

    const listNode = $from.node(depth - 1);
    const itemStart = $from.before(depth);
    if (listNode.childCount > 1) {
      return {
        from: itemStart,
        to: itemStart + node.nodeSize,
        replaceWithParagraph: false,
      };
    }

    const listParent = $from.node(depth - 2);
    if (!DIRECT_PARENT_TYPES.has(listParent.type.name)) return null;
    const listStart = $from.before(depth - 1);
    return {
      from: listStart,
      to: listStart + listNode.nodeSize,
      replaceWithParagraph: listParent.childCount <= 1,
    };
  }
  return null;
}

function findDirectBlockTarget($from: ResolvedPos): DeleteTarget | null {
  for (let depth = $from.depth; depth >= 1; depth--) {
    const node = $from.node(depth);
    if (!node.isBlock || PROTECTED_TYPES.has(node.type.name)) continue;

    const parent = $from.node(depth - 1);
    if (!DIRECT_PARENT_TYPES.has(parent.type.name)) continue;

    const from = $from.before(depth);
    return {
      from,
      to: from + node.nodeSize,
      replaceWithParagraph: parent.childCount <= 1,
    };
  }
  return null;
}
