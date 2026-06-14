// 마크다운 미리보기 렌더 (지연 로드 전용)
// react-markdown + remark-gfm 를 eager 청크에서 분리하기 위해 별도 모듈로 둔다.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownPreviewRenderProps {
  source: string;
}

export default function MarkdownPreviewRender({ source }: MarkdownPreviewRenderProps) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>;
}
