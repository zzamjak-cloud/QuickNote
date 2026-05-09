import type { Editor } from "@tiptap/core";

/** 우측 패널(목차·댓글)에서 메인 에디터로 스크롤/포커스 요청할 때 쓰는 단일 브리지 */
let activeEditor: Editor | null = null;

/** 메인 Editor 마운트 시 등록, 언마운트 시 해제 */
export function registerEditorNavigation(editor: Editor | null): void {
  activeEditor = editor;
}

export function unregisterEditorNavigation(editor: Editor): void {
  if (activeEditor === editor) activeEditor = null;
}

/** 문서에서 레벨 1~maxLevel 헤딩의 시작 위치만 순서대로 수집 */
function collectHeadingPositions(maxLevel: number): number[] {
  const editor = activeEditor;
  if (!editor || editor.isDestroyed) return [];
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return;
    const level = node.attrs.level as number;
    if (level >= 1 && level <= maxLevel) positions.push(pos);
  });
  return positions;
}

/**
 * 목차 JSON 추출 순서와 동일하게, N번째(0-based) 헤딩(레벨 1~4)으로 이동
 */
export function scrollToOutlineHeadingIndex(index: number): boolean {
  const editor = activeEditor;
  if (!editor || editor.isDestroyed) return false;
  const positions = collectHeadingPositions(4);
  const startPos = positions[index];
  if (startPos === undefined) return false;

  const docSize = editor.state.doc.content.size;
  const caret = Math.min(startPos + 1, docSize);
  try {
    editor.chain().focus().setTextSelection(caret).scrollIntoView().run();
  } catch {
    try {
      editor.chain().focus().setNodeSelection(startPos).scrollIntoView().run();
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * 블록 시작 pos로 이동(댓글 카드 클릭). 원자 노드면 NodeSelection 시도
 */
/** 블록 노드 attrs.id 로 스크롤(UniqueID) */
export function scrollToBlockId(blockId: string): boolean {
  const foundPos = findBlockPositionById(blockId);
  if (foundPos === null) return false;
  return scrollToBlockPosition(foundPos);
}

export function findBlockPositionById(blockId: string): number | null {
  const editor = activeEditor;
  if (!editor || editor.isDestroyed) return null;
  let foundPos: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    const id = node.attrs.id as string | undefined;
    if (id === blockId) {
      foundPos = pos;
      return false;
    }
  });
  return foundPos;
}

export function scrollToBlockPosition(blockPos: number): boolean {
  const editor = activeEditor;
  if (!editor || editor.isDestroyed) return false;
  const doc = editor.state.doc;
  if (blockPos < 0 || blockPos > doc.content.size) return false;

  const $pos = doc.resolve(blockPos);
  const nodeAfter = $pos.nodeAfter;
  if (nodeAfter?.isAtom && nodeAfter.isLeaf) {
    try {
      editor.chain().focus().setNodeSelection(blockPos).scrollIntoView().run();
      return true;
    } catch {
      /* fall through */
    }
  }
  const caret = Math.min(blockPos + 1, doc.content.size);
  try {
    editor.chain().focus().setTextSelection(caret).scrollIntoView().run();
  } catch {
    return false;
  }
  return true;
}
