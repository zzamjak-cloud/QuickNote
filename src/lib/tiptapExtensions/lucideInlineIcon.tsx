import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { createElement } from "react";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";

function getLucideIcon(name: string): LucideIcon {
  return (
    (LucideIcons as unknown as Record<string, LucideIcon | undefined>)[name] ??
    LucideIcons.Circle
  );
}

function LucideInlineIconView({ node, selected }: NodeViewProps) {
  const name = typeof node.attrs.name === "string" ? node.attrs.name : "Circle";
  const color = typeof node.attrs.color === "string" ? node.attrs.color : "#3f3f46";

  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      className={[
        "mx-0.5 inline-flex h-[1.15em] w-[1.15em] align-[-0.16em]",
        "items-center justify-center rounded-sm",
        selected ? "ring-2 ring-blue-400" : "",
      ].join(" ")}
      data-lucide-inline-icon=""
      data-name={name}
      data-color={color}
    >
      {createElement(getLucideIcon(name), {
        size: "1em",
        strokeWidth: 2,
        color,
      })}
    </NodeViewWrapper>
  );
}

export const LucideInlineIcon = Node.create({
  name: "lucideInlineIcon",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      name: { default: "Circle" },
      color: { default: "#3f3f46" },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-lucide-inline-icon]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-lucide-inline-icon": "",
        "data-name": node.attrs.name as string,
        "data-color": node.attrs.color as string,
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LucideInlineIconView);
  },

  addCommands() {
    return {
      insertLucideInlineIcon:
        (attrs: { name: string; color: string }) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    lucideInlineIcon: {
      insertLucideInlineIcon: (attrs: {
        name: string;
        color: string;
      }) => ReturnType;
    };
  }
}
