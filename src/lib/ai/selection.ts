// 에디터 선택 영역 → AI 컨텍스트(마크다운 + 교체용 범위) 직렬화.
import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/react";
import { pageDocToMarkdown } from "../export/pageToMarkdown";
import { AI_CONTEXT_MAX_CHARS } from "./contextBuilder";

export type AiSelectionPayload = {
  markdown: string;
  range: { from: number; to: number };
  truncated: boolean;
};

export function getSelectionAiPayload(editor: Editor): AiSelectionPayload | null {
  const { from, to } = editor.state.selection;
  if (from >= to) return null;

  // 선택 Slice 를 doc 으로 감싸 전체 doc 직렬화기(pageDocToMarkdown)를 재사용
  const slice = editor.state.selection.content();
  const content = slice.content.toJSON() as JSONContent[] | null;
  if (!content || content.length === 0) return null;

  let markdown = pageDocToMarkdown({ type: "doc", content }).trim();
  if (!markdown) return null;

  let truncated = false;
  if (markdown.length > AI_CONTEXT_MAX_CHARS) {
    markdown = `${markdown.slice(0, AI_CONTEXT_MAX_CHARS)}\n\n…(내용이 길어 이후 생략됨)`;
    truncated = true;
  }
  return { markdown, range: { from, to }, truncated };
}
