import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/react";
import { notionMarkdownToDoc } from "../notionImport/markdownToDoc";

/** 클립보드 마크다운을 페이지 문서 블록으로 삽입한다. */
export async function pasteMarkdownAsDocContent(editor: Editor): Promise<boolean> {
  let text = "";
  try {
    text = (await navigator.clipboard.readText()).trim();
  } catch {
    return false;
  }
  if (!text) return false;

  const doc = notionMarkdownToDoc(text);
  const blocks = (doc.content ?? []).filter(Boolean) as JSONContent[];
  if (blocks.length === 0) return false;

  editor.chain().focus().insertContent(blocks).run();
  return true;
}
