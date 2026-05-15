// 마크다운 언어 codeBlock: 미리보기 | 소스 탭 (기본 미리보기)

import { useState } from "react";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlockLowlightStable } from "./codeBlockLowlightStable";

/** codeBlockCopy 와 동일 복사 아이콘(버튼 스타일 일관) */
function MarkdownCodeCopyIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function isMarkdownLanguage(lang: unknown): boolean {
  const s = String(lang ?? "")
    .toLowerCase()
    .trim();
  return s === "markdown" || s === "md";
}

const tabBtnBase =
  "rounded px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400";

/** 탭 아래 본문: 미리보기·소스 공통 뷰포트(박스 높이 = 스크롤 영역) */
const MARKDOWN_PANEL_H = "min(70vh,560px)";

function MarkdownCodeBlockNodeView(props: NodeViewProps) {
  const { node } = props;
  const isMd = isMarkdownLanguage(node.attrs.language);
  const [tab, setTab] = useState<"preview" | "source">("preview");

  if (!isMd) {
    return (
      <NodeViewWrapper className="qn-codeblock-nodeview my-4" data-language={String(node.attrs.language ?? "")}>
        <pre className="m-0 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
          <code
            className={
              node.attrs.language
                ? `language-${String(node.attrs.language)} block px-3 py-2.5 text-[15px] leading-relaxed`
                : "block px-3 py-2.5 text-[15px] leading-relaxed"
            }
          >
            <NodeViewContent spellCheck={false} />
          </code>
        </pre>
      </NodeViewWrapper>
    );
  }

  const text = node.textContent;
  const previewActive = tab === "preview";

  return (
    <NodeViewWrapper className="qn-markdown-code-block my-4 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950">
      <div
        className="flex gap-0.5 border-b border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-900"
        role="tablist"
        aria-label="마크다운 보기 모드"
      >
        <button
          type="button"
          role="tab"
          aria-selected={previewActive}
          className={`${tabBtnBase} ${
            previewActive
              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
          onClick={() => setTab("preview")}
        >
          미리보기
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!previewActive}
          className={`${tabBtnBase} ${
            !previewActive
              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
          onClick={() => setTab("source")}
        >
          마크다운
        </button>
      </div>
      {/* 고정 높이 한 덩어리: 테두리·스크롤 경계가 동일(미리보기/소스 규격 일치) */}
      <div
        className="relative w-full overflow-hidden rounded-b-lg"
        style={{ height: MARKDOWN_PANEL_H }}
      >
        <button
          type="button"
          className="qn-code-copy-btn pointer-events-auto absolute right-2 top-2 z-30"
          title="코드 복사"
          aria-label="코드 복사"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void navigator.clipboard.writeText(props.node.textContent);
          }}
        >
          <MarkdownCodeCopyIcon />
          <span className="qn-code-copy-label">복사</span>
        </button>
        <div
          className={`absolute inset-0 box-border overflow-y-auto bg-zinc-100 px-3 pb-2 pl-3 pr-14 pt-10 prose prose-sm prose-zinc max-w-none dark:bg-zinc-950 dark:prose-invert prose-headings:text-orange-700 prose-a:text-amber-700 dark:prose-headings:text-orange-300 dark:prose-a:text-amber-400 prose-strong:text-zinc-800 dark:prose-strong:text-zinc-100 ${
            previewActive ? "z-10" : "pointer-events-none invisible z-0"
          }`}
        >
          {text.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          ) : (
            <p className="my-0 text-sm text-zinc-500 dark:text-zinc-400">
              비어 있습니다. 「마크다운」 탭에서 편집하세요.
            </p>
          )}
        </div>
        <pre
          className={`qn-markdown-code-source hljs absolute inset-0 m-0 box-border overflow-auto rounded-b-lg border-0 bg-[#2d2d32] text-zinc-200 dark:bg-[#2d2d32] dark:text-zinc-200 ${
            previewActive ? "pointer-events-none invisible z-0" : "z-10"
          }`}
        >
          <code className="language-markdown block text-[15px] leading-relaxed">
            <NodeViewContent spellCheck={false} />
          </code>
        </pre>
      </div>
    </NodeViewWrapper>
  );
}

/** lowlight 안정 플러그인 유지 + 마크다운 블록에 미리보기 탭 */
export const CodeBlockLowlightWithMarkdownPreview = CodeBlockLowlightStable.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MarkdownCodeBlockNodeView);
  },
});
