import type { Node as PMNode } from "@tiptap/pm/model";
import { isToggleContentEmpty } from "./toggleContentEmpty";

function isToggleTitleEmpty(node: PMNode): boolean {
  if (node.type.name !== "toggle") return true;
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    if (child.type.name === "toggleHeader") return child.content.size === 0;
  }
  return true;
}

export function getToggleNodeViewRenderKey(node: PMNode): string {
  return [
    node.attrs.open ? "open" : "closed",
    node.attrs.indent ?? 0,
    node.attrs.backgroundColor ?? "",
    node.attrs.blockTextColor ?? "",
    isToggleTitleEmpty(node) ? "title-empty" : "title-filled",
    isToggleContentEmpty(node) ? "empty" : "filled",
  ].join("|");
}
