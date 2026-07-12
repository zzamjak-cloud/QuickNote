// AI 컨텍스트 조립 — Phase 1 은 페이지 본문(마크다운)만.
// 총량 상한을 넘으면 절단하고 "생략" 을 명시해 모델이 부분 컨텍스트임을 인지하게 한다.

import { usePageStore } from "../../store/pageStore";
import { pageDocToMarkdown } from "../export/pageToMarkdown";

/** 컨텍스트 총량 상한(문자) — 서버 MAX_CONTEXT_CHARS(120K)보다 여유 있게 작게. */
export const AI_CONTEXT_MAX_CHARS = 100_000;

export type AiContext = {
  label: string;
  markdown: string;
  pageId: string | null;
  truncated: boolean;
};

export function buildPageAiContext(pageId: string): AiContext | null {
  const page = usePageStore.getState().pages[pageId];
  if (!page) return null;

  const title = page.title?.trim() || "제목 없음";
  let markdown = `# ${title}\n\n${pageDocToMarkdown(page.doc)}`;
  let truncated = false;
  if (markdown.length > AI_CONTEXT_MAX_CHARS) {
    markdown = `${markdown.slice(0, AI_CONTEXT_MAX_CHARS)}\n\n…(내용이 길어 이후 생략됨)`;
    truncated = true;
  }
  return { label: title, markdown, pageId, truncated };
}
