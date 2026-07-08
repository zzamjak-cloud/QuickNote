// v4 단순화: 이미지 노드는 src/alt/width/height 만 보유.
// src 가 quicknote-image:// 스킴이면 React NodeView 가 PreSignedURL 로 비동기 해석.

import { memo, useState } from "react";
import Image from "@tiptap/extension-image";
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  type NodeViewProps,
} from "@tiptap/react";
import { useImageUrl, initialImageUrl } from "../images/hooks";
import {
  nextCaptionAlign,
  toggleSelectedMediaCaption,
  type CaptionAlign,
} from "./mediaCaption";
import { useLazyNodeViewActivation } from "./useLazyNodeViewActivation";

function shallowImageAttrsEqual(
  prev: NodeViewProps,
  next: NodeViewProps,
): boolean {
  const a = prev.node.attrs as Record<string, unknown>;
  const b = next.node.attrs as Record<string, unknown>;
  return (
    prev.selected === next.selected &&
    a.src === b.src &&
    a.alt === b.alt &&
    a.width === b.width &&
    a.height === b.height &&
    a.align === b.align &&
    a.caption === b.caption &&
    a.captionAlign === b.captionAlign &&
    a.id === b.id
  );
}

const ALIGN_TO_FLEX: Record<string, string> = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
};

const ImageView = memo(function ImageView(props: NodeViewProps) {
  const attrs = props.node.attrs as {
    src?: string | null;
    alt?: string | null;
    width?: number | string | null;
    height?: number | string | null;
    align?: string | null;
    caption?: string | null;
    captionAlign?: CaptionAlign | null;
  };
  const align = attrs.align ?? "left";
  const hasCaption = typeof attrs.caption === "string";
  const captionAlign = attrs.captionAlign ?? "left";
  const captionMaxWidth = attrs.width ? `${attrs.width}px` : "100%";
  const [previewOpen, setPreviewOpen] = useState(false);
  // 이미지 URL 이 이미 캐시돼 있으면(예: 협업 바인딩으로 에디터가 리마운트된 경우) 지연 활성화를
  // 건너뛰고 즉시 active 로 시작한다 — placeholder pulse 플래시(깜빡임) 제거. 미캐시는 기존대로 lazy.
  const hasCachedUrl = initialImageUrl(attrs.src ?? null) != null;
  const activation = useLazyNodeViewActivation<HTMLDivElement>({
    selected: props.selected,
    forceActive: previewOpen,
    initialActive: hasCachedUrl,
  });
  const { url, error, reportLoadError } = useImageUrl(
    activation.active ? attrs.src ?? null : null,
  );

  return (
    <NodeViewWrapper
      as="div"
      ref={activation.ref}
      // 블록 컨테이너 내 가로 정렬 — flex + justify 로 좌/중앙/우 배치.
      className="qn-image-shell flex max-w-full flex-col leading-none"
      style={{ alignItems: ALIGN_TO_FLEX[align] ?? "flex-start" }}
      draggable={false}
      onPointerDown={activation.activate}
      onFocusCapture={activation.activate}
    >
      {error ? (
        <span className="text-xs text-red-500">[image error]</span>
      ) : url ? (
        <img
          src={url}
          alt={attrs.alt ?? ""}
          loading="lazy"
          width={attrs.width ?? undefined}
          height={attrs.height ?? undefined}
          className="block h-auto"
          style={
            attrs.width
              ? { width: `${attrs.width}px`, maxWidth: "100%" }
              : { maxWidth: "100%" }
          }
          draggable={false}
          // 만료된 PreSignedURL·손상 blob 캐시 자가 치유 — 캐시 폐기 후 재해석.
          onError={reportLoadError}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setPreviewOpen(true);
          }}
        />
      ) : (
        <span className="inline-block w-12 h-12 bg-neutral-100 dark:bg-neutral-800 animate-pulse align-middle" />
      )}
      {hasCaption ? (
        <div className="mt-1 flex w-full items-center gap-1" style={{ maxWidth: captionMaxWidth }}>
          <button
            type="button"
            className="h-3 w-3 shrink-0 rounded-[2px] bg-zinc-300 hover:bg-zinc-400 dark:bg-zinc-600 dark:hover:bg-zinc-500"
            title="캡션 정렬"
            aria-label="캡션 정렬"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.updateAttributes({ captionAlign: nextCaptionAlign(captionAlign) });
            }}
          />
          <input
            data-qn-caption-input="true"
            type="text"
            value={attrs.caption ?? ""}
            placeholder="캡션 입력…"
            // 캡션은 노드 attrs.caption 에 저장 (plain text). 본문 doc 흐름과 분리.
            onChange={(e) => props.updateAttributes({ caption: e.target.value })}
            onBlur={(e) => {
              if (e.currentTarget.value.trim() === "") props.updateAttributes({ caption: null });
            }}
            onKeyDown={(e) => {
              // Enter/Backspace(빈 캡션) 가 에디터 본문으로 전파돼 노드 삭제·블록 분할되는 것 차단.
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
              e.stopPropagation();
            }}
            className="min-w-0 flex-1 border-none bg-transparent text-xs text-zinc-500 outline-none placeholder:text-zinc-400 dark:text-zinc-400"
            style={{ textAlign: captionAlign }}
          />
        </div>
      ) : null}
      {previewOpen && url ? (
        <div
          className="fixed inset-0 z-[780] flex items-center justify-center bg-black/75 p-6"
          role="dialog"
          aria-modal="true"
          onClick={() => setPreviewOpen(false)}
        >
          <img
            src={url}
            alt={attrs.alt ?? ""}
            className="block h-auto w-auto max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}, shallowImageAttrsEqual);

// width/height 를 Tiptap 노드 attrs 로 명시 등록.
// 누락 시 ImageResizeOverlay 의 updateAttributes 가 schema 에 없는 attr 로 간주되어 무시되고,
// 렌더 시 img 의 width/height prop 도 항상 undefined → max-w-full 로 column 전체 너비 박스로 표시됨.
export const ImageBlock = Image.extend({
  name: "image",

  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: (el) => el.getAttribute("src") || el.getAttribute("data-qn-src"),
        renderHTML: (attrs) => {
          const raw = typeof attrs.src === "string" ? attrs.src : "";
          // 브라우저가 quicknote-* 스킴을 직접 로드하지 않도록 차단.
          if (raw.startsWith("quicknote-image://") || raw.startsWith("quicknote-file://")) {
            return { src: "", "data-qn-src": raw };
          }
          return raw ? { src: raw } : {};
        },
      },
      width: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute("width");
          if (!v) return null;
          const n = parseInt(v, 10);
          return Number.isFinite(n) && n > 0 ? n : null;
        },
        renderHTML: (attrs) =>
          attrs.width ? { width: String(attrs.width) } : {},
      },
      height: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute("height");
          if (!v) return null;
          const n = parseInt(v, 10);
          return Number.isFinite(n) && n > 0 ? n : null;
        },
        renderHTML: (attrs) =>
          attrs.height ? { height: String(attrs.height) } : {},
      },
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-id"),
        renderHTML: (attrs) =>
          attrs.id ? { "data-id": String(attrs.id) } : {},
      },
      align: {
        default: "left",
        parseHTML: (el) => el.getAttribute("data-align") ?? "left",
        renderHTML: (attrs) =>
          attrs.align && attrs.align !== "left" ? { "data-align": String(attrs.align) } : {},
      },
      caption: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-caption"),
        renderHTML: (attrs) =>
          typeof attrs.caption === "string" ? { "data-caption": String(attrs.caption) } : {},
      },
      captionAlign: {
        default: "left",
        parseHTML: (el) => el.getAttribute("data-caption-align") ?? "left",
        renderHTML: (attrs) =>
          attrs.captionAlign && attrs.captionAlign !== "left"
            ? { "data-caption-align": String(attrs.captionAlign) }
            : {},
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-c": ({ editor }) => toggleSelectedMediaCaption(editor, ["image"]),
      "Mod-Shift-C": ({ editor }) => toggleSelectedMediaCaption(editor, ["image"]),
      "Ctrl-Shift-c": ({ editor }) => toggleSelectedMediaCaption(editor, ["image"]),
      "Ctrl-Shift-C": ({ editor }) => toggleSelectedMediaCaption(editor, ["image"]),
    };
  },

  addNodeView() {
    // 정렬·캡션 지원을 위해 블록 컨테이너(div) 로 렌더. selectednode 시각은 CSS 에서 이미지에만 적용.
    return ReactNodeViewRenderer(ImageView, { as: "div" });
  },
});
