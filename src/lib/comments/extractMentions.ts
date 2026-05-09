import type { JSONContent } from "@tiptap/react";

/** 최소 에디터 JSON에서 멘션 노드의 memberId(attrs.id) 수집 */
export function extractMentionMemberIdsFromDoc(doc: JSONContent | null): string[] {
  const ids: string[] = [];
  function walk(n: JSONContent | null | undefined): void {
    if (!n) return;
    if (n.type === "mention" && n.attrs && typeof n.attrs.id === "string") {
      ids.push(n.attrs.id);
    }
    if (n.content?.length) {
      for (const c of n.content) walk(c);
    }
  }
  walk(doc);
  return [...new Set(ids)];
}
