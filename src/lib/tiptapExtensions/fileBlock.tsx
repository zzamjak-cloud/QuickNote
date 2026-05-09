// 일반 파일 노드 — atom block.
// mimeType 에 따라 NodeView 가 비디오 플레이어 / 오디오 플레이어 / 파일 카드를 렌더한다.
// src 는 quicknote-file:// 가상 스킴 ref(또는 외부 URL).

import { Node, mergeAttributes } from "@tiptap/core";
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  type NodeViewProps,
} from "@tiptap/react";
import { useFileUrl } from "../files/hooks";
import { memo, useState } from "react";
import { File, FileArchive, FileText, Film, Music } from "lucide-react";

type FileAttrs = {
  id?: string | null;
  src?: string | null;
  name?: string | null;
  size?: number | null;
  mime?: string | null;
  mimeType?: string | null;
  contentType?: string | null;
  width?: number | null;
  height?: number | null;
  uploading?: boolean | null;
  uploadId?: string | null;
  uploadError?: boolean | null;
};

function formatSize(n: number | null | undefined): string {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function renderIcon(mime: string | null | undefined, size: number, className?: string) {
  const props = { size, className };
  if (!mime) return <File {...props} />;
  if (mime.startsWith("video/")) return <Film {...props} />;
  if (mime.startsWith("audio/")) return <Music {...props} />;
  if (mime === "application/pdf") return <FileText {...props} />;
  if (/zip|gzip|tar|7z|rar/.test(mime)) return <FileArchive {...props} />;
  if (mime.startsWith("text/") || mime === "application/json") return <FileText {...props} />;
  return <File {...props} />;
}

function fileAttrsChanged(a: FileAttrs, b: FileAttrs): boolean {
  return (
    a.id !== b.id ||
    a.src !== b.src ||
    a.name !== b.name ||
    a.size !== b.size ||
    a.mime !== b.mime ||
    a.mimeType !== b.mimeType ||
    a.contentType !== b.contentType ||
    a.width !== b.width ||
    a.height !== b.height ||
    a.uploading !== b.uploading ||
    a.uploadId !== b.uploadId ||
    a.uploadError !== b.uploadError
  );
}

function areFileNodeViewsEqual(prev: NodeViewProps, next: NodeViewProps): boolean {
  return !fileAttrsChanged(
    prev.node.attrs as FileAttrs,
    next.node.attrs as FileAttrs,
  );
}

const FileView = memo(function FileView(props: NodeViewProps) {
  const attrs = props.node.attrs as FileAttrs;
  const { url, error } = useFileUrl(attrs.src ?? null);
  const [zoom, setZoom] = useState(false);
  const mime = attrs.mime ?? attrs.mimeType ?? attrs.contentType ?? "";
  const isUploading = !!attrs.uploading;
  const hasUploadError = !!attrs.uploadError;

  if (isUploading) {
    return (
      <NodeViewWrapper
        as="div"
        className="qn-file-shell my-2"
        data-drag-handle
      >
        <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
          {renderIcon(mime, 18, "shrink-0 text-zinc-500 dark:text-zinc-400")}
          <span className="min-w-0 flex-1 truncate">{attrs.name || "파일"}</span>
          <span className="shrink-0 text-xs text-blue-600 dark:text-blue-300">
            첨부 중...
          </span>
        </div>
      </NodeViewWrapper>
    );
  }

  if (error || hasUploadError) {
    return (
      <NodeViewWrapper
        as="div"
        className="qn-file-shell my-2"
        data-drag-handle
      >
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-900/60 dark:bg-red-950/40">
          파일을 불러오지 못했습니다
          {error ? ` (${error.slice(0, 60)})` : ""}
        </div>
      </NodeViewWrapper>
    );
  }

  // 비디오 인라인 플레이어 + 크기 조정 핸들 + 더블클릭 시 확대 미리보기.
  // wrapping 박스 없이 video element 가 직접 자식 — 레터박스(검은색 여백) 방지.
  if (mime.startsWith("video/")) {
    const styleW = attrs.width ? `${attrs.width}px` : undefined;
    return (
      <NodeViewWrapper
        as="div"
        className="qn-file-shell my-2 leading-none"
        data-drag-handle
      >
        {url ? (
          <video
            src={url}
            controls
            className="block h-auto rounded-lg border border-zinc-200 dark:border-zinc-700"
            onDoubleClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setZoom(true);
            }}
            style={{
              width: styleW ?? "auto",
              maxWidth: "100%",
            }}
          />
        ) : (
          <div className="flex h-32 w-64 items-center justify-center rounded-lg bg-zinc-100 text-xs text-zinc-400 dark:bg-zinc-800">
            로딩…
          </div>
        )}
        {zoom && url && (
          <div
            className="fixed inset-0 z-[400] flex items-center justify-center bg-black/85 p-6"
            role="dialog"
            aria-modal="true"
            onClick={() => setZoom(false)}
          >
            <video
              src={url}
              controls
              autoPlay
              className="max-h-full max-w-full"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </NodeViewWrapper>
    );
  }

  // 오디오 인라인 플레이어
  if (mime.startsWith("audio/")) {
    return (
      <NodeViewWrapper
        as="div"
        className="qn-file-shell my-2"
        data-drag-handle
      >
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mb-1 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
            {renderIcon(mime, 14)}
            <span className="truncate">{attrs.name || "audio"}</span>
            <span className="ml-auto text-[10px] text-zinc-400">
              {formatSize(attrs.size)}
            </span>
          </div>
          {url ? (
            <audio src={url} controls className="w-full" />
          ) : (
            <div className="text-xs text-zinc-400">로딩…</div>
          )}
        </div>
      </NodeViewWrapper>
    );
  }

  // 일반 파일 카드 — 아이콘 + 이름 + 크기, 클릭 시 새 탭에서 열기/다운로드
  return (
    <NodeViewWrapper
      as="div"
      className="qn-file-shell my-2"
      data-drag-handle
    >
      <a
        href={url ?? "#"}
        target="_blank"
        rel="noopener noreferrer"
        download={attrs.name ?? undefined}
        onClick={(e) => {
          if (!url) e.preventDefault();
        }}
        className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 no-underline transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
      >
        {renderIcon(mime, 20, "shrink-0 text-zinc-500 dark:text-zinc-400")}
        <span className="min-w-0 flex-1 truncate">
          {attrs.name || "파일"}
        </span>
        <span className="shrink-0 text-[11px] text-zinc-400">
          {formatSize(attrs.size)}
        </span>
      </a>
    </NodeViewWrapper>
  );
}, areFileNodeViewsEqual);

export const FileBlock = Node.create({
  name: "fileBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-src"),
        renderHTML: (attrs) =>
          attrs.src ? { "data-src": String(attrs.src) } : {},
      },
      name: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-name"),
        renderHTML: (attrs) =>
          attrs.name ? { "data-name": String(attrs.name) } : {},
      },
      size: {
        default: null,
        parseHTML: (el) => {
          const v = (el as HTMLElement).getAttribute("data-size");
          if (!v) return null;
          const n = parseInt(v, 10);
          return Number.isFinite(n) && n > 0 ? n : null;
        },
        renderHTML: (attrs) =>
          attrs.size ? { "data-size": String(attrs.size) } : {},
      },
      mime: {
        default: null,
        parseHTML: (el) =>
          (el as HTMLElement).getAttribute("data-mime") ??
          (el as HTMLElement).getAttribute("data-mime-type") ??
          (el as HTMLElement).getAttribute("data-content-type"),
        renderHTML: (attrs) =>
          attrs.mime ? { "data-mime": String(attrs.mime) } : {},
      },
      mimeType: {
        default: null,
      },
      contentType: {
        default: null,
      },
      width: {
        default: null,
        parseHTML: (el) => {
          const v = (el as HTMLElement).getAttribute("data-w");
          if (!v) return null;
          const n = parseInt(v, 10);
          return Number.isFinite(n) && n > 0 ? n : null;
        },
        renderHTML: (attrs) =>
          attrs.width ? { "data-w": String(attrs.width) } : {},
      },
      height: {
        default: null,
        parseHTML: (el) => {
          const v = (el as HTMLElement).getAttribute("data-h");
          if (!v) return null;
          const n = parseInt(v, 10);
          return Number.isFinite(n) && n > 0 ? n : null;
        },
        renderHTML: (attrs) =>
          attrs.height ? { "data-h": String(attrs.height) } : {},
      },
      uploading: {
        default: false,
        parseHTML: (el) =>
          (el as HTMLElement).getAttribute("data-uploading") === "true",
        renderHTML: (attrs) =>
          attrs.uploading ? { "data-uploading": "true" } : {},
      },
      uploadId: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-upload-id"),
        renderHTML: (attrs) =>
          attrs.uploadId ? { "data-upload-id": String(attrs.uploadId) } : {},
      },
      uploadError: {
        default: false,
        parseHTML: (el) =>
          (el as HTMLElement).getAttribute("data-upload-error") === "true",
        renderHTML: (attrs) =>
          attrs.uploadError ? { "data-upload-error": "true" } : {},
      },
      id: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-id"),
        renderHTML: (attrs) =>
          attrs.id ? { "data-id": String(attrs.id) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-file-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-file-block": "" }),
    ];
  },

  addNodeView() {
    // block-level wrapper. atom block 이라 PM 이 노드 시작 위치에 NodeSelection 을 만들고
    // ImageResizeOverlay 가 nodeDOM 의 inner img/video 를 측정해 핸들 위치를 잡는다.
    return ReactNodeViewRenderer(FileView, { as: "div" });
  },
});
