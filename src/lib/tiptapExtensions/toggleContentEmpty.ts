import type { Node as PMNode } from "@tiptap/pm/model";

/** 본문이 없는 리프가 아닌 블록(이미지·표·DB 등) */
const NON_EMPTY_LEAF_TYPES = new Set([
  "image",
  "horizontalRule",
  "youtube",
  "databaseBlock",
  "bookmarkBlock",
  "fileBlock",
  "buttonBlock",
  "tabBlock",
  "columnLayout",
  "pageLink",
  "lucideIcon",
  "dateInline",
]);

function normalizedPlainText(node: PMNode): string {
  return node.textContent.replace(/\u00a0/g, " ").replace(/\s+/g, "").trim();
}

/** 단일 블록이 실질적으로 비었는지(빈 문단·빈 목록·빈 콜아웃 등) */
export function isBlockEffectivelyEmpty(node: PMNode): boolean {
  const name = node.type.name;
  if (NON_EMPTY_LEAF_TYPES.has(name)) return false;

  if (node.isTextblock) return normalizedPlainText(node).length === 0;

  if (name === "table") {
    let hasText = false;
    node.descendants((n) => {
      if (n.isTextblock && normalizedPlainText(n).length > 0) hasText = true;
    });
    return !hasText;
  }

  if (node.childCount === 0) return true;

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && !isBlockEffectivelyEmpty(child)) return false;
  }
  return true;
}

/** toggleContent 안에 채워진 블록이 하나도 없으면 true */
export function isToggleContentEmpty(toggleNode: PMNode): boolean {
  if (toggleNode.type.name !== "toggle") return true;
  const contentNode: PMNode | null = (() => {
    for (let i = 0; i < toggleNode.childCount; i++) {
      const child = toggleNode.child(i);
      if (child.type.name === "toggleContent") return child;
    }
    return null;
  })();
  if (!contentNode) return true;
  if (contentNode.childCount === 0) return true;

  for (let i = 0; i < contentNode.childCount; i++) {
    const block = contentNode.child(i);
    if (block && !isBlockEffectivelyEmpty(block)) return false;
  }
  return true;
}
