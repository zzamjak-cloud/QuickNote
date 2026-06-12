import type { JSONContent } from "@tiptap/react";
import { createPageMentionParagraph } from "./htmlToDoc/pageMentions";

type StructuralChild = { pageId: string; title: string };

/** link-to-page 멘션 해소 실패로 제목 텍스트만 남은 문단을 구조적 자식 페이지 멘션으로 치환 */
export function hydrateStructuralChildPageMentions(
  doc: JSONContent,
  children: StructuralChild[],
): { doc: JSONContent; changed: boolean } {
  if (children.length === 0) return { doc, changed: false };
  const byTitle = new Map<string, StructuralChild>();
  for (const child of children) {
    const key = child.title.trim();
    if (key) byTitle.set(key, child);
  }
  if (byTitle.size === 0) return { doc, changed: false };

  let changed = false;
  const walk = (node: JSONContent): JSONContent => {
    if (
      node.type === "paragraph"
      && Array.isArray(node.content)
      && node.content.length === 1
    ) {
      const inline = node.content[0];
      if (
        inline?.type === "text"
        && typeof inline.text === "string"
        && (!inline.marks || inline.marks.length === 0)
      ) {
        const child = byTitle.get(inline.text.trim());
        if (child) {
          changed = true;
          return createPageMentionParagraph(child.pageId, child.title);
        }
      }
    }
    if (!Array.isArray(node.content)) return node;
    return { ...node, content: node.content.map(walk) };
  };

  return { doc: walk(doc), changed };
}
