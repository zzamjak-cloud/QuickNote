// 마크다운 언어 codeBlock: 미리보기 | 소스 탭 (기본 미리보기)

import { lazy, Suspense, useState } from "react";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import CodeBlock from "@tiptap/extension-code-block";
import { Eye, X } from "lucide-react";
import { DialogBase } from "../ui-primitives";
import { CodeBlockLowlightStable } from "./codeBlockLowlightStable";

// react-markdown + remark-gfm 는 미리보기 탭에서만 필요하므로 지연 로드해 eager 청크에서 분리한다.
const MarkdownPreviewRender = lazy(() => import("./MarkdownPreviewRender"));

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

/** 미리보기 본문 글자 크기 — 마크다운 소스 탭(15px)과 동일하게 맞춤 */
const MARKDOWN_PREVIEW_FONT_SIZE = "15px";

/** 인라인 미리보기·확대 모달이 공유하는 prose 색상 규칙(렌더 일관성). */
const PREVIEW_PROSE_CLASS =
  "prose prose-sm prose-zinc max-w-none dark:prose-invert prose-headings:text-orange-700 prose-a:text-amber-700 dark:prose-headings:text-orange-300 dark:prose-a:text-amber-400 prose-strong:text-zinc-800 dark:prose-strong:text-zinc-100";

function MarkdownCodeBlockNodeView(props: NodeViewProps) {
  const { node } = props;
  const isMd = isMarkdownLanguage(node.attrs.language);
  // 미리보기 모달 — 에디터(contenteditable) 밖(portal)에서 렌더해 본문 텍스트를 자유롭게 드래그·복사.
  // 인라인 미리보기는 ProseMirror 가 DOM 선택을 문서 선택과 강제 동기화해 부분 선택이 막히므로, 모달로 우회.
  const [expanded, setExpanded] = useState(false);

  if (!isMd) {
    return (
      <NodeViewWrapper className="qn-codeblock-nodeview my-4" data-language={String(node.attrs.language ?? "")}>
        {/* 기본 코드블럭은 어두운 회색 배경(#2d2d32) 으로 통일.
            밝은 회색(bg-zinc-50)은 마크다운 미리보기 탭 전용으로만 유지. */}
        <pre className="hljs m-0 overflow-x-auto rounded-lg border border-zinc-700 bg-[#2d2d32] text-zinc-200">
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

  return (
    <NodeViewWrapper
      className="qn-markdown-code-block my-4 overflow-hidden rounded-lg border border-zinc-700 bg-[#26262b]"
      data-language="markdown"
    >
      {/* 상단 헤더바: 라벨 + 미리보기·복사 버튼. 본문(코드) 안에는 버튼을 두지 않는다. */}
      <div className="flex items-center gap-2 border-b border-zinc-700 bg-[#26262b] px-2.5 py-1.5">
        <span className="text-xs font-medium text-zinc-400">마크다운</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            className="qn-code-copy-btn"
            title="미리보기 (텍스트 선택·복사 가능)"
            aria-label="마크다운 미리보기"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setExpanded(true);
            }}
          >
            <Eye size={13} />
            <span className="qn-code-copy-label">미리보기</span>
          </button>
          <button
            type="button"
            className="qn-code-copy-btn"
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
        </div>
      </div>
      <pre className="qn-markdown-code-source hljs m-0 overflow-x-auto bg-[#2d2d32] text-zinc-200">
        <code className="language-markdown block px-3 py-2.5 text-[15px] leading-relaxed">
          <NodeViewContent spellCheck={false} />
        </code>
      </pre>
      {expanded && (
        <DialogBase
          open
          onClose={() => setExpanded(false)}
          widthClassName="max-w-4xl"
          labelId="qn-md-preview-modal-title"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2
              id="qn-md-preview-modal-title"
              className="text-base font-semibold text-zinc-900 dark:text-zinc-100"
            >
              마크다운 미리보기
            </h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded px-2 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                title="전체 복사"
                onClick={() => void navigator.clipboard.writeText(text)}
              >
                전체 복사
              </button>
              <button
                type="button"
                className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                title="닫기"
                aria-label="닫기"
                onClick={() => setExpanded(false)}
              >
                <X size={16} />
              </button>
            </div>
          </div>
          {/* 에디터 밖(portal) 이라 텍스트 자유 선택·부분 복사 가능 */}
          <div
            className={`max-h-[78vh] select-text overflow-y-auto ${PREVIEW_PROSE_CLASS}`}
            style={{ fontSize: MARKDOWN_PREVIEW_FONT_SIZE }}
          >
            {text.trim() ? (
              <Suspense fallback={<div className="text-xs text-zinc-400">로딩…</div>}>
                <MarkdownPreviewRender source={text} />
              </Suspense>
            ) : (
              <p className="my-0 text-sm text-zinc-500 dark:text-zinc-400">
                비어 있습니다.
              </p>
            )}
          </div>
        </DialogBase>
      )}
    </NodeViewWrapper>
  );
}

/** lowlight 로딩 전에도 첫 렌더부터 마크다운 미리보기 NodeView 를 쓴다. */
export const CodeBlockWithMarkdownPreview = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MarkdownCodeBlockNodeView);
  },
});

/** lowlight 안정 플러그인 유지 + 마크다운 블록에 미리보기 탭 */
export const CodeBlockLowlightWithMarkdownPreview = CodeBlockLowlightStable.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MarkdownCodeBlockNodeView);
  },
});
