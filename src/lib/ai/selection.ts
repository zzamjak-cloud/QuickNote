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

/**
 * 최상위 블록 시작 좌표 목록 → AI 컨텍스트. 드래그 핸들 메뉴에서 사용 —
 * 박스 선택(boxSelectedStarts)·다중 블록 텍스트 선택 모두 이 경로로 직렬화한다.
 * 교체 범위는 [최소 시작, 최대 끝] — 마퀴/PM 다중 선택은 문서상 연속 블록이라 안전.
 */
export function getBlocksAiPayload(
  editor: Editor,
  blockStarts: readonly number[],
): AiSelectionPayload | null {
  const doc = editor.state.doc;
  const sorted = [...blockStarts].sort((a, b) => a - b);
  const content: JSONContent[] = [];
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (const start of sorted) {
    const node = doc.nodeAt(start);
    if (!node) continue;
    content.push(node.toJSON() as JSONContent);
    from = Math.min(from, start);
    to = Math.max(to, start + node.nodeSize);
  }
  if (content.length === 0 || from >= to) return null;

  let markdown = pageDocToMarkdown({ type: "doc", content }).trim();
  if (!markdown) return null;
  let truncated = false;
  if (markdown.length > AI_CONTEXT_MAX_CHARS) {
    markdown = `${markdown.slice(0, AI_CONTEXT_MAX_CHARS)}\n\n…(내용이 길어 이후 생략됨)`;
    truncated = true;
  }
  return { markdown, range: { from, to }, truncated };
}

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
