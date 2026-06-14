import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useImageUrl } from "../images/hooks";

function ImageInlineIconView({ node, selected }: NodeViewProps) {
  const src = typeof node.attrs.src === "string" ? node.attrs.src : "";
  const { url, error } = useImageUrl(src || null);

  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      className={[
        "mx-0.5 inline-flex h-[1.15em] w-[1.15em] align-[-0.16em]",
        "items-center justify-center overflow-hidden rounded-sm",
        selected ? "ring-2 ring-blue-400" : "",
      ].join(" ")}
      data-image-inline-icon=""
      data-src={src}
    >
      {url && !error ? (
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <span className="text-[10px] leading-none text-zinc-400">…</span>
      )}
    </NodeViewWrapper>
  );
}

export const ImageInlineIcon = Node.create({
  name: "imageInlineIcon",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-image-inline-icon]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-image-inline-icon": "",
        "data-src": node.attrs.src as string,
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageInlineIconView);
  },
});
