// Notion HTML import 시 페이지 멘션 처리 헬퍼.
// 동기 시점에서 페이지 id 가 아직 없으면 deferred 토큰을 텍스트로 박아두고,
// 페이지 생성 후 별도 패스에서 실 mention 노드로 치환한다.
import type { JSONContent } from "@tiptap/react";

export const DEFERRED_PAGE_MENTION_PREFIX = "__QN_PM__";

export interface PageMentionResolver {
  resolvePageMentionByHref?: (
    href: string,
  ) => { pageId: string; label?: string } | null;
  deferPageMentions?: boolean;
}

export function createDeferredMentionToken(pageId: string, label: string): string {
  return `${DEFERRED_PAGE_MENTION_PREFIX}${encodeURIComponent(pageId)}::${encodeURIComponent(label)}__`;
}

export function parseDeferredMentionToken(
  token: string,
): { pageId: string; label: string } | null {
  if (!token.startsWith(DEFERRED_PAGE_MENTION_PREFIX) || !token.endsWith("__")) {
    return null;
  }
  const raw = token.slice(DEFERRED_PAGE_MENTION_PREFIX.length, -2);
  const sepIdx = raw.indexOf("::");
  if (sepIdx <= 0) return null;
  const pageId = decodeURIComponent(raw.slice(0, sepIdx));
  const label = decodeURIComponent(raw.slice(sepIdx + 2));
  if (!pageId) return null;
  return { pageId, label: label || "페이지" };
}

export function createPageMentionParagraph(pageId: string, label: string): JSONContent {
  return {
    type: "paragraph",
    content: [
      {
        type: "mention",
        attrs: {
          id: `p:${pageId}`,
          label,
          mentionKind: "page",
        },
      },
    ],
  };
}

export function pageMentionParagraphFromAnchor(
  anchor: HTMLElement,
  options?: PageMentionResolver,
): JSONContent | null {
  const href = anchor.getAttribute("href") ?? "";
  const pageMention = options?.resolvePageMentionByHref?.(href);
  if (!pageMention?.pageId) return null;
  const labelText = (anchor.textContent ?? "").trim();
  const label = pageMention.label ?? labelText ?? "페이지";
  if (options?.deferPageMentions) {
    return {
      type: "paragraph",
      content: [{ type: "text", text: createDeferredMentionToken(pageMention.pageId, label) }],
    };
  }
  return createPageMentionParagraph(pageMention.pageId, label);
}
