import type { JSONContent } from "@tiptap/react";
import type { HtmlToDocOptions } from "./types";
import {
  parseDeferredMentionToken,
  createPageMentionParagraph,
} from "./pageMentions";

export function assetBlockFromAnchor(anchor: HTMLElement, options?: HtmlToDocOptions): JSONContent | null {
  const href = anchor.getAttribute("href") ?? "";
  if (!href) return null;
  if (options?.resolvePageMentionByHref?.(href)) return null;
  return options?.resolveMediaNode?.(href, anchor) ?? options?.resolveImageNode?.(href, anchor) ?? null;
}

// link-to-page figure 의 멘션을 해소하지 못했을 때의 폴백.
// link-to-page 안의 아이콘 <img> 는 장식용이므로 본문 이미지로 떨어뜨리면 안 된다.
// 대상 페이지를 못 찾으면 최소한 제목 텍스트만 보존한다(아이콘 이미지 누출 방지).
export function linkToPageFallbackParagraph(anchor: HTMLElement): JSONContent | null {
  const title = (anchor.textContent ?? "").trim();
  if (!title) return null;
  return { type: "paragraph", content: [{ type: "text", text: title }] };
}

export function relocateDeferredMentionsInToggleBlocks(blocks: JSONContent[]): JSONContent[] {
  type MentionPlacement = { insertAt: number; mention: JSONContent };
  const placements: MentionPlacement[] = [];
  const cleanedBlocks: JSONContent[] = [];
  blocks.forEach((block) => {
    if (block.type !== "paragraph" || !Array.isArray(block.content)) {
      cleanedBlocks.push(block);
      return;
    }
    const nextContent: JSONContent[] = [];
    let markerFound = false;
    for (const inline of block.content) {
      if (inline.type !== "text" || typeof inline.text !== "string") {
        nextContent.push(inline);
        continue;
      }
      const text = inline.text;
      const tokenRegex = /__QN_PM__.+?__/g;
      let lastIdx = 0;
      let hasMarker = false;
      for (const tokenMatch of text.matchAll(tokenRegex)) {
        hasMarker = true;
        const token = tokenMatch[0] ?? "";
        const start = tokenMatch.index ?? 0;
        if (start > lastIdx) {
          nextContent.push({ ...inline, text: text.slice(lastIdx, start) });
        }
        const parsed = parseDeferredMentionToken(token);
        if (parsed) {
          placements.push({
            insertAt: cleanedBlocks.length + 1,
            mention: createPageMentionParagraph(parsed.pageId, parsed.label),
          });
          markerFound = true;
        } else {
          nextContent.push({ ...inline, text: token });
        }
        lastIdx = start + token.length;
      }
      if (lastIdx < text.length) {
        nextContent.push({ ...inline, text: text.slice(lastIdx) });
      } else if (!hasMarker && lastIdx === 0) {
        nextContent.push(inline);
      }
    }
    const filtered = nextContent.filter((item) => !(item.type === "text" && (item.text ?? "").length === 0));
    if (filtered.length > 0 || !markerFound) {
      cleanedBlocks.push({ ...block, content: filtered });
    } else {
      placements.forEach((placement) => {
        if (placement.insertAt === cleanedBlocks.length + 1) placement.insertAt = cleanedBlocks.length;
      });
    }
  });
  if (placements.length === 0) return cleanedBlocks;

  const tailMentions = placements.map((p) => p.mention);
  const working = [...cleanedBlocks, ...tailMentions];
  placements.forEach((placement, idx) => {
    const mentionFromTail = tailMentions[idx];
    if (!mentionFromTail) return;
    const currentIdx = working.indexOf(mentionFromTail);
    if (currentIdx < 0) return;
    working.splice(currentIdx, 1);
    const insertAt = Math.max(0, Math.min(placement.insertAt + idx, working.length));
    working.splice(insertAt, 0, mentionFromTail);
  });
  return working;
}

export function resolveRelativePath(basePath: string, href: string): string {
  const baseParts = basePath.split("/").slice(0, -1);
  const hrefParts = href.split("/");
  for (const part of hrefParts) {
    if (!part || part === ".") continue;
    if (part === "..") baseParts.pop();
    else baseParts.push(part);
  }
  return baseParts.join("/");
}
