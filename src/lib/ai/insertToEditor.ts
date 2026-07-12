// AI 응답(마크다운)을 에디터에 삽입/교체 — 노션 임포트의 md→doc 변환기 재사용.
// TipTap 트랜잭션 1회로 반영되므로 협업(Y.Doc) 페이지에서도 안전하게 동기화된다.
import type { JSONContent } from "@tiptap/react";
import { notionMarkdownToDoc } from "../notionImport/markdownToDoc";
import { getEditorForPage } from "../editor/editorByPageRegistry";

function markdownToBlocks(markdown: string): JSONContent[] {
  const doc = notionMarkdownToDoc(markdown);
  return (doc.content ?? []).filter(Boolean) as JSONContent[];
}

/** 현재 커서(또는 선택 끝) 위치에 삽입. 성공 여부 반환. */
export function insertMarkdownAtCursor(pageId: string, markdown: string): boolean {
  const editor = getEditorForPage(pageId);
  if (!editor || !editor.isEditable) return false;
  const blocks = markdownToBlocks(markdown);
  if (blocks.length === 0) return false;
  return editor.chain().focus().insertContent(blocks).run();
}

/** 저장해 둔 선택 범위를 AI 결과로 교체. 문서가 변해 범위가 무효면 실패(false). */
export function replaceRangeWithMarkdown(
  pageId: string,
  range: { from: number; to: number },
  markdown: string,
): boolean {
  const editor = getEditorForPage(pageId);
  if (!editor || !editor.isEditable) return false;
  const docSize = editor.state.doc.content.size;
  if (range.from < 0 || range.to > docSize || range.from >= range.to) return false;
  const blocks = markdownToBlocks(markdown);
  if (blocks.length === 0) return false;
  try {
    return editor.chain().focus().insertContentAt(range, blocks).run();
  } catch (error) {
    console.error("[ai] 선택 영역 교체 실패", error);
    return false;
  }
}
