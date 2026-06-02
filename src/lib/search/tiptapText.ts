import type { JSONContent } from "@tiptap/react";

/**
 * TipTap/ProseMirror JSON 노드 트리에서 텍스트만 재귀적으로 수집한다.
 * 알 수 없는 노드 타입도 자식(content)을 계속 순회하므로 신규 블록 타입에 강건하다.
 */
export function collectNodeText(node: JSONContent): string {
  if (typeof node.text === "string") return node.text;
  if (!node.content?.length) return "";
  return node.content.map(collectNodeText).join("");
}
