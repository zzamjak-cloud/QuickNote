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
import { memo, useEffect, useRef, useState, type MouseEvent } from "react";
import { File, FileArchive, FileText, Film, Music } from "lucide-react";
import {
  nextCaptionAlign,
  toggleSelectedMediaCaption,
  type CaptionAlign,
} from "./mediaCaption";
import { useLazyNodeViewActivation } from "./useLazyNodeViewActivation";

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
  align?: string | null;
  caption?: string | null;
  captionAlign?: CaptionAlign | null;
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
    a.uploadError !== b.uploadError ||
    a.align !== b.align ||
    a.caption !== b.caption ||
    a.captionAlign !== b.captionAlign
  );
}

function areFileNodeViewsEqual(prev: NodeViewProps, next: NodeViewProps): boolean {
  return (
    prev.selected === next.selected &&
    !fileAttrsChanged(
      prev.node.attrs as FileAttrs,
      next.node.attrs as FileAttrs,
    )
  );
}

const ALIGN_TO_FLEX: Record<string, string> = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
};

function MediaCaptionInput({
  caption,
  captionAlign,
  widthPx,
  onChange,
  onCaptionAlignChange,
  onRemoveEmpty,
}: {
  caption: string;
  captionAlign: CaptionAlign;
  widthPx: number | null | undefined;
  onChange: (v: string) => void;
  onCaptionAlignChange: (v: CaptionAlign) => void;
  onRemoveEmpty: () => void;
}) {
  return (
    <div
      className="mt-1 flex w-full items-center gap-1"
      // 정렬 버튼 + 캡션 텍스트가 하나의 단위로 좌/중앙/우로 함께 이동. gap-1 유지.
      style={{
        maxWidth: widthPx ? `${widthPx}px` : "100%",
        justifyContent: ALIGN_TO_FLEX[captionAlign] ?? "flex-start",
      }}
    >
      <button
        type="button"
        className="h-3 w-3 shrink-0 rounded-[2px] bg-zinc-300 hover:bg-zinc-400 dark:bg-zinc-600 dark:hover:bg-zinc-500"
        title="캡션 정렬"
        aria-label="캡션 정렬"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onCaptionAlignChange(nextCaptionAlign(captionAlign));
        }}
      />
      <input
        data-qn-caption-input="true"
        type="text"
        value={caption}
        placeholder="캡션 입력…"
        // 텍스트 폭에 맞춰 단위를 잡고, textAlign 은 쓰지 않아 버튼-텍스트 gap 을 유지한다.
        size={Math.max(6, caption.length || "캡션 입력…".length)}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          if (e.currentTarget.value.trim() === "") onRemoveEmpty();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          e.stopPropagation();
        }}
        className="min-w-0 max-w-full border-none bg-transparent text-xs text-zinc-500 outline-none placeholder:text-zinc-400 dark:text-zinc-400"
      />
    </div>
  );
}

const FileView = memo(function FileView(props: NodeViewProps) {
  const attrs = props.node.attrs as FileAttrs;
  const [zoom, setZoom] = useState(false);
  const inlineVideoRef = useRef<HTMLVideoElement | null>(null);
  const align = attrs.align ?? "left";
  const caption = attrs.caption;
  const hasCaption = typeof caption === "string";
  const captionAlign = attrs.captionAlign ?? "left";
  const alignItems = ALIGN_TO_FLEX[align] ?? "flex-start";
  let mime = attrs.mime ?? attrs.mimeType ?? attrs.contentType ?? "";
  // mime 이 비어 있거나 일반(application/octet-stream)이면 파일명 확장자로 보강
  if (!mime || mime === "application/octet-stream") {
    const nameLower = (attrs.name ?? "").toLowerCase();
    if (/\.gif$/.test(nameLower)) mime = "image/gif";
    else if (/\.(png|jpe?g|webp|avif)$/.test(nameLower)) mime = "image/png";
    else if (/\.(mp4|m4v|mov|webm)$/.test(nameLower)) mime = "video/mp4";
    else if (/\.(mp3|wav|m4a|ogg)$/.test(nameLower)) mime = "audio/mpeg";
  }
  const isUploading = !!attrs.uploading;
  const hasUploadError = !!attrs.uploadError;
  const activation = useLazyNodeViewActivation<HTMLDivElement>({
    selected: props.selected,
    forceActive: zoom || isUploading || hasUploadError,
  });
  const shouldResolveFile =
    !isUploading && !hasUploadError && activation.active;
  const { url, error } = useFileUrl(shouldResolveFile ? attrs.src ?? null : null, {
    sizeBytes: typeof attrs.size === "number" ? attrs.size : undefined,
    mime,
  });

  useEffect(() => {
    const videoEl = inlineVideoRef.current;
    if (!videoEl) return;
    const blockNativeFullscreen = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      // 브라우저 기본 비디오 전체화면(dblclick) 트리거 차단.
      if ("stopImmediatePropagation" in event) {
        (event as Event & { stopImmediatePropagation: () => void }).stopImmediatePropagation();
      }
      setZoom(true);
    };
    videoEl.addEventListener("dblclick", blockNativeFullscreen, { capture: true });
    return () => {
      videoEl.removeEventListener("dblclick", blockNativeFullscreen, { capture: true });
    };
  }, [url]);

  if (isUploading) {
    return (
      <NodeViewWrapper
        as="div"
        ref={activation.ref}
        className="qn-file-shell my-2"
        data-drag-handle
        onPointerDown={activation.activate}
        onFocusCapture={activation.activate}
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
        ref={activation.ref}
        className="qn-file-shell my-2"
        data-drag-handle
        onPointerDown={activation.activate}
        onFocusCapture={activation.activate}
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
        ref={activation.ref}
        className="qn-file-shell flex flex-col leading-none"
        style={{ alignItems }}
        data-drag-handle
        onPointerDown={activation.activate}
        onFocusCapture={activation.activate}
        onDoubleClickCapture={(e: MouseEvent<HTMLDivElement>) => {
          const target = e.target as HTMLElement | null;
          if (!target?.closest("video")) return;
          e.preventDefault();
          e.stopPropagation();
          setZoom(true);
        }}
      >
        {url ? (
          <video
            src={url}
            ref={inlineVideoRef}
            controls
            controlsList="nofullscreen noremoteplayback"
            disablePictureInPicture
            className="block h-auto rounded-lg border border-zinc-200 dark:border-zinc-700"
            onDoubleClickCapture={(e) => {
              e.preventDefault();
              e.stopPropagation();
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
        {hasCaption ? (
          <MediaCaptionInput
            caption={caption ?? ""}
            captionAlign={captionAlign}
            widthPx={attrs.width}
            onChange={(v) => props.updateAttributes({ caption: v })}
            onCaptionAlignChange={(v) => props.updateAttributes({ captionAlign: v })}
            onRemoveEmpty={() => props.updateAttributes({ caption: null })}
          />
        ) : null}
        {zoom && url && (
          <div
            className="fixed inset-0 z-[780] flex items-center justify-center bg-black/75 p-6"
            role="dialog"
            aria-modal="true"
            onClick={() => setZoom(false)}
          >
            <video
              src={url}
              controls
              className="block h-auto w-auto max-h-full max-w-full object-contain"
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            />
          </div>
        )}
      </NodeViewWrapper>
    );
  }

  // 이미지(특히 GIF) 인라인 미리보기 — 애니메이션 GIF 폴백 등에 사용
  if (mime.startsWith("image/")) {
    const styleW = attrs.width ? `${attrs.width}px` : undefined;
    return (
      <NodeViewWrapper
        as="div"
        ref={activation.ref}
        className="qn-file-shell flex flex-col leading-none"
        style={{ alignItems }}
        data-drag-handle
        onPointerDown={activation.activate}
        onFocusCapture={activation.activate}
      >
        {url ? (
          <img
            src={url}
            alt={attrs.name ?? ""}
            className="block h-auto rounded-lg border border-zinc-200 dark:border-zinc-700"
            onDoubleClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setZoom(true);
            }}
            style={{ width: styleW ?? "auto", maxWidth: "100%" }}
          />
        ) : (
          <div className="flex h-32 w-64 items-center justify-center rounded-lg bg-zinc-100 text-xs text-zinc-400 dark:bg-zinc-800">
            로딩…
          </div>
        )}
        {hasCaption ? (
          <MediaCaptionInput
            caption={caption ?? ""}
            captionAlign={captionAlign}
            widthPx={attrs.width}
            onChange={(v) => props.updateAttributes({ caption: v })}
            onCaptionAlignChange={(v) => props.updateAttributes({ captionAlign: v })}
            onRemoveEmpty={() => props.updateAttributes({ caption: null })}
          />
        ) : null}
        {zoom && url && (
          <div
            className="fixed inset-0 z-[400] flex items-center justify-center bg-black/85 p-6"
            role="dialog"
            aria-modal="true"
            onClick={() => setZoom(false)}
          >
            <img
              src={url}
              alt={attrs.name ?? ""}
              className="block h-auto w-auto max-h-full max-w-full object-contain"
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
        ref={activation.ref}
        className="qn-file-shell my-2"
        data-drag-handle
        onPointerDown={activation.activate}
        onFocusCapture={activation.activate}
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
      ref={activation.ref}
      className="qn-file-shell my-2"
      data-drag-handle
      onPointerDown={activation.activate}
      onFocusCapture={activation.activate}
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
      align: {
        default: "left",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-align") ?? "left",
        renderHTML: (attrs) =>
          attrs.align && attrs.align !== "left" ? { "data-align": String(attrs.align) } : {},
      },
      caption: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-caption"),
        renderHTML: (attrs) =>
          typeof attrs.caption === "string" ? { "data-caption": String(attrs.caption) } : {},
      },
      captionAlign: {
        default: "left",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-caption-align") ?? "left",
        renderHTML: (attrs) =>
          attrs.captionAlign && attrs.captionAlign !== "left"
            ? { "data-caption-align": String(attrs.captionAlign) }
            : {},
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-c": ({ editor }) => toggleSelectedMediaCaption(editor, ["fileBlock"]),
      "Mod-Shift-C": ({ editor }) => toggleSelectedMediaCaption(editor, ["fileBlock"]),
      "Ctrl-Shift-c": ({ editor }) => toggleSelectedMediaCaption(editor, ["fileBlock"]),
      "Ctrl-Shift-C": ({ editor }) => toggleSelectedMediaCaption(editor, ["fileBlock"]),
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
