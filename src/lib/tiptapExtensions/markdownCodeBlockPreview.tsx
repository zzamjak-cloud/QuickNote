// 마크다운 언어 codeBlock: 미리보기 | 소스 탭 (기본 미리보기)

import { useState } from "react";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlockLowlightStable } from "./codeBlockLowlightStable";

function isMarkdownLanguage(lang: unknown): boolean {
  const s = String(lang ?? "")
    .toLowerCase()
    .trim();
  return s === "markdown" || s === "md";
}

const tabBtnBase =
  "rounded px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400";

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
                ? `language-${String(node.attrs.language)}`
                : undefined
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
      <div className="relative">
        {previewActive ? (
          <div className="prose prose-sm prose-zinc relative z-10 max-w-none min-h-[4rem] max-h-[min(70vh,560px)] overflow-y-auto px-3 py-2 dark:prose-invert prose-headings:text-orange-700 prose-a:text-amber-700 dark:prose-headings:text-orange-300 dark:prose-a:text-amber-400 prose-strong:text-zinc-800 dark:prose-strong:text-zinc-100">
            {text.trim() ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
            ) : (
              <p className="my-0 text-sm text-zinc-400">비어 있습니다. 「마크다운」 탭에서 편집하세요.</p>
            )}
          </div>
        ) : null}
        <pre
          className={
            previewActive
              ? "pointer-events-none invisible absolute inset-0 z-0 m-0 max-h-[min(70vh,560px)] overflow-auto border-0 bg-zinc-50 dark:bg-zinc-900"
              : "relative z-10 m-0 max-h-[min(70vh,560px)] overflow-auto rounded-b-md border-0 bg-zinc-50 dark:bg-zinc-900"
          }
        >
          <code className="language-markdown block px-3 py-2 text-sm">
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
