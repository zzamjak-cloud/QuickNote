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
          className="block max-w-full h-auto"
          draggable={false}
        />
      ) : (
        <span className="inline-block w-12 h-12 bg-neutral-100 dark:bg-neutral-800 animate-pulse align-middle" />
      )}
    </NodeViewWrapper>
  );
}

export const ImageBlock = Image.extend({
  name: "image",

  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});
