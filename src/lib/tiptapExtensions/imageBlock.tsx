// v4 단순화: 이미지 노드는 src/alt/width/height 만 보유.
// src 가 quicknote-image:// 스킴이면 React NodeView 가 PreSignedURL 로 비동기 해석.

import Image from "@tiptap/extension-image";
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  type NodeViewProps,
} from "@tiptap/react";
import { useImageUrl } from "../images/hooks";

function ImageView(props: NodeViewProps) {
  const attrs = props.node.attrs as {
    src?: string | null;
    alt?: string | null;
    width?: number | string | null;
    height?: number | string | null;
  };
  const { url, error } = useImageUrl(attrs.src ?? null);

  return (
    <NodeViewWrapper
      as="span"
      className="qn-image-shell inline-block max-w-full my-1 align-middle"
    >
      {error ? (
        <span className="text-xs text-red-500">[image error]</span>
      ) : url ? (
        <img
          src={url}
          alt={attrs.alt ?? ""}
          width={attrs.width ?? undefined}
          height={attrs.height ?? undefined}
          className="block h-auto"
          style={
            attrs.width
              ? { width: `${attrs.width}px`, maxWidth: "100%" }
              : { maxWidth: "100%" }
          }
          draggable={false}
        />
      ) : (
        <span className="inline-block w-12 h-12 bg-neutral-100 dark:bg-neutral-800 animate-pulse align-middle" />
      )}
    </NodeViewWrapper>
  );
}

// width/height 를 Tiptap 노드 attrs 로 명시 등록.
// 누락 시 ImageResizeOverlay 의 updateAttributes 가 schema 에 없는 attr 로 간주되어 무시되고,
// 렌더 시 img 의 width/height prop 도 항상 undefined → max-w-full 로 column 전체 너비 박스로 표시됨.
export const ImageBlock = Image.extend({
  name: "image",

  addAttributes() {
    return {
      ...this.parent?.(),
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
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});
