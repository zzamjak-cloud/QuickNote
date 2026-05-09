import type { JSONContent } from "@tiptap/react";
import { normalizeMentionMemberId } from "./mentionMemberIds";

export type MentionMemberHit = {
  memberId: string;
  blockId: string | null;
};

const MENTION_ANCHOR_NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "listItem",
  "taskItem",
  "codeBlock",
  "blockquote",
  "callout",
  "toggleHeader",
  "tableCell",
  "tableHeader",
]);

/** 최소 에디터 JSON에서 멘션 노드의 memberId(attrs.id) 수집 */
export function extractMentionMemberIdsFromDoc(doc: JSONContent | null): string[] {
  const ids: string[] = [];
  function walk(n: JSONContent | null | undefined): void {
    if (!n) return;
    if (n.type === "mention" && n.attrs && typeof n.attrs.id === "string") {
      const mentionKind =
        typeof n.attrs.mentionKind === "string" ? n.attrs.mentionKind : "member";
      const id = normalizeMentionMemberId(n.attrs.id);
      if (mentionKind === "member" && id) ids.push(id);
    }
    if (n.content?.length) {
      for (const c of n.content) walk(c);
    }
  }
  walk(doc);
  return [...new Set(ids)];
}

export function extractMentionMemberHitsFromDoc(
  doc: JSONContent | null,
): MentionMemberHit[] {
  const hits: MentionMemberHit[] = [];
  function walk(
    n: JSONContent | null | undefined,
    currentBlockId: string | null,
  ): void {
    if (!n) return;
    const nodeBlockId =
      n.type &&
      MENTION_ANCHOR_NODE_TYPES.has(n.type) &&
      n.attrs &&
      typeof n.attrs.id === "string"
        ? n.attrs.id
        : currentBlockId;
    if (n.type === "mention" && n.attrs && typeof n.attrs.id === "string") {
      const mentionKind =
        typeof n.attrs.mentionKind === "string" ? n.attrs.mentionKind : "member";
      const id = normalizeMentionMemberId(n.attrs.id);
      if (mentionKind === "member" && id) {
        hits.push({ memberId: id, blockId: nodeBlockId });
      }
    }
    if (n.content?.length) {
      for (const c of n.content) walk(c, nodeBlockId);
    }
  }
  walk(doc, null);
  return hits;
}
