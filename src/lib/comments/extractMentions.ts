import type { JSONContent } from "@tiptap/react";
import { normalizeMentionMemberId } from "./mentionMemberIds";

export type MentionMemberHit = {
  memberId: string;
  blockId: string | null;
  /**
   * 멘션이 속한 부모 블록(문단·제목 등) 전체 플레인 텍스트.
   * 블록 id 기반 조회보다 신뢰할 수 있다( DFS 첫 매칭·컨테이너 id 상속 오류 방지 ).
   */
  previewInlineHostText?: string;
};

/** 멘션 노드를 제외한 인라인·블록 플레인 텍스트(알림 미리보기용) */
function jsonPlainSkippingMentions(node: JSONContent | null | undefined): string {
  if (!node) return "";
  if (node.type === "mention") {
    return "";
  }
  const own = typeof node.text === "string" ? node.text : "";
  const child = node.content?.map(jsonPlainSkippingMentions).join(" ") ?? "";
  return `${own} ${child}`.replace(/\s+/g, " ").trim();
}

/** 멘션 JSON 노드의 직계 부모에서 미리보기 문자열 계산(doc 루트는 제외) */
function previewFromMentionParent(parent: JSONContent | null | undefined): string {
  if (!parent?.type || parent.type === "doc") return "";
  return jsonPlainSkippingMentions(parent);
}

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
    parent: JSONContent | null | undefined,
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
        const previewInlineHostText = previewFromMentionParent(parent);
        hits.push({
          memberId: id,
          blockId: nodeBlockId,
          ...(previewInlineHostText !== ""
            ? { previewInlineHostText }
            : {}),
        });
      }
    }
    if (n.content?.length) {
      for (const c of n.content) walk(c, nodeBlockId, n);
    }
  }
  walk(doc, null, undefined);
  return hits;
}
