import type { JSONContent } from "@tiptap/react";
import { emptyPanelState } from "../../types/database";
import {
  isLikelyUrlText,
  normalizeImportedLinkHref,
  summarizeImportedLinkText,
} from "./linkUtils";

const CLASS_COLOR_MAP: Record<string, { css: string; token: string }> = {
  "highlight-default": { css: "#2c2c2b", token: "default" },
  "highlight-teal": { css: "#0f766e", token: "teal" },
  "highlight-blue": { css: "#2563eb", token: "blue" },
  "highlight-red": { css: "#e11d48", token: "red" },
  "highlight-green": { css: "#16a34a", token: "green" },
  "highlight-orange": { css: "#ea580c", token: "orange" },
  "highlight-yellow": { css: "#ca8a04", token: "yellow" },
  "highlight-purple": { css: "#9333ea", token: "purple" },
  "highlight-pink": { css: "#db2777", token: "pink" },
  "highlight-gray": { css: "#6b7280", token: "gray" },
  "block-color-default": { css: "#2c2c2b", token: "default" },
  "block-color-teal": { css: "#0f766e", token: "teal" },
  "block-color-blue": { css: "#2563eb", token: "blue" },
  "block-color-red": { css: "#e11d48", token: "red" },
  "block-color-green": { css: "#16a34a", token: "green" },
  "block-color-orange": { css: "#ea580c", token: "orange" },
  "block-color-yellow": { css: "#ca8a04", token: "yellow" },
  "block-color-purple": { css: "#9333ea", token: "purple" },
  "block-color-pink": { css: "#db2777", token: "pink" },
  "block-color-gray": { css: "#6b7280", token: "gray" },
};

const HIGHLIGHT_BG_COLOR_MAP: Record<string, string> = {
  "highlight-default_background": "#f3f4f6",
  "highlight-gray_background": "#e5e7eb",
  "highlight-brown_background": "#fed7aa",
  "highlight-orange_background": "#fdba74",
  "highlight-yellow_background": "#fde047",
  "highlight-teal_background": "#5eead4",
  "highlight-blue_background": "#93c5fd",
  "highlight-purple_background": "#c4b5fd",
  "highlight-pink_background": "#f9a8d4",
  "highlight-red_background": "#fca5a5",
};

function textNode(text: string, marks?: JSONContent["marks"]): JSONContent {
  return marks && marks.length > 0 ? { type: "text", text, marks } : { type: "text", text };
}

function textNodesWithAutoLinks(
  raw: string,
  baseMarks: NonNullable<JSONContent["marks"]>,
): JSONContent[] {
  const urlRegex = /(https?:\/\/[^\s<>"')]+|www\.[^\s<>"')]+)/g;
  const out: JSONContent[] = [];
  let last = 0;
  let match: RegExpExecArray | null = null;
  while ((match = urlRegex.exec(raw)) !== null) {
    const start = match.index;
    const hit = match[0] ?? "";
    if (start > last) {
      out.push(textNode(raw.slice(last, start), baseMarks.length > 0 ? baseMarks : undefined));
    }
    const normalized = normalizeImportedLinkHref(hit);
    if (normalized) {
      out.push(
        textNode(
          summarizeImportedLinkText(hit),
          mergeMarks(baseMarks, [{ type: "link", attrs: { href: normalized, target: "_blank", rel: "noopener noreferrer nofollow" } }]),
        ),
      );
    } else {
      out.push(textNode(hit, baseMarks.length > 0 ? baseMarks : undefined));
    }
    last = start + hit.length;
  }
  if (last < raw.length) {
    out.push(textNode(raw.slice(last), baseMarks.length > 0 ? baseMarks : undefined));
  }
  return out.length > 0 ? out : [textNode(raw, baseMarks.length > 0 ? baseMarks : undefined)];
}

function parseColorFromStyle(styleValue: string | null): string | null {
  if (!styleValue) return null;
  const m = styleValue.match(/color\s*:\s*([^;]+)/i);
  return m?.[1]?.trim() ?? null;
}

function parseColorFromClass(className: string): { css: string; token: string } | null {
  const names = className.split(/\s+/).filter(Boolean);
  for (const name of names) {
    if (CLASS_COLOR_MAP[name]) return CLASS_COLOR_MAP[name];
  }
  return null;
}

function mergeMarks(base: NonNullable<JSONContent["marks"]>, extra: NonNullable<JSONContent["marks"]>): NonNullable<JSONContent["marks"]> {
  const out = [...base];
  for (const mark of extra) {
    const exists = out.some((m) => m.type === mark.type && JSON.stringify(m.attrs ?? {}) === JSON.stringify(mark.attrs ?? {}));
    if (!exists) out.push(mark);
  }
  return out;
}

function imageNodeFromElement(
  img: HTMLElement,
  options?: HtmlToDocOptions,
): JSONContent | null {
  const rawSrc = img.getAttribute("src") ?? "";
  if (!rawSrc) return null;
  const custom = options?.resolveMediaNode?.(rawSrc, img) ?? options?.resolveImageNode?.(rawSrc, img);
  if (custom) return custom;
  const resolved = options?.resolveImageSrc?.(rawSrc) ?? rawSrc;
  if (!resolved) return null;
  return {
    type: "image",
    attrs: {
      src: resolved,
      alt: img.getAttribute("alt") ?? "",
    },
  };
}

function mediaNodeFromElement(
  el: HTMLElement,
  options?: HtmlToDocOptions,
): JSONContent | null {
  const rawSrc = el.getAttribute("src") ?? el.querySelector("source[src]")?.getAttribute("src") ?? "";
  if (!rawSrc) return null;
  return options?.resolveMediaNode?.(rawSrc, el) ?? options?.resolveImageNode?.(rawSrc, el) ?? null;
}

function listNodeFromElement(el: HTMLElement, blockColor: string | null, blockToken: string | null): JSONContent {
  const tag = el.tagName.toLowerCase();
  const isOrdered = tag === "ol";
  const items: JSONContent[] = [];
  const liNodes = Array.from(el.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.tagName.toLowerCase() === "li",
  );

  for (const li of liNodes) {
    const paragraphInlines: JSONContent[] = [];
    const nestedBlocks: JSONContent[] = [];

    const nestedLists = Array.from(li.querySelectorAll("ul, ol")).filter(
      (list) => list instanceof HTMLElement && list.closest("li") === li,
    ) as HTMLElement[];

    for (const nestedList of nestedLists) {
      nestedBlocks.push(listNodeFromElement(nestedList, blockColor, blockToken));
    }

    const liClone = li.cloneNode(true) as HTMLElement;
    for (const nested of Array.from(liClone.querySelectorAll("ul, ol"))) {
      nested.remove();
    }
    for (const child of Array.from(liClone.childNodes)) {
      paragraphInlines.push(...inlineFromNode(child, blockToken ? null : blockColor, []));
    }

    const listItemContent: JSONContent[] = [{
      type: "paragraph",
      content: paragraphInlines.length > 0 ? paragraphInlines : [],
    }];
    listItemContent.push(...nestedBlocks);
    items.push({
      type: "listItem",
      content: listItemContent,
    });
  }

  return {
    type: isOrdered ? "orderedList" : "bulletList",
    attrs: isOrdered
      ? blockToken
        ? { start: 1, blockTextColor: blockToken }
        : { start: 1 }
      : blockToken
        ? { blockTextColor: blockToken }
        : undefined,
    content: items,
  };
}

function normalizedLinesFromParagraph(el: HTMLElement): string[] {
  const raw = el.innerHTML
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return raw
    .split("\n")
    .map((line) => line.replace(/&nbsp;/g, " ").trim())
    .filter((line) => line.length > 0);
}

function dashListBlocksFromParagraph(
  el: HTMLElement,
  blockColor: string | null,
  blockToken: string | null,
  options?: HtmlToDocOptions,
): JSONContent[] | null {
  if (el.querySelector("ul, ol")) return null;
  const lines = normalizedLinesFromParagraph(el);
  if (lines.length === 0) return null;
  const hasDashLine = lines.some((line) => /^-\s+/.test(line));
  if (!hasDashLine) return null;

  const introLines: string[] = [];
  const items: Array<{ lines: string[] }> = [];
  let currentItem: { lines: string[] } | null = null;
  let listStarted = false;

  for (const line of lines) {
    if (/^-\s+/.test(line)) {
      listStarted = true;
      currentItem = { lines: [line.replace(/^-\s+/, "").trim()] };
      items.push(currentItem);
      continue;
    }
    if (!listStarted) {
      introLines.push(line);
      continue;
    }
    if (currentItem) {
      currentItem.lines.push(line);
    }
  }

  if (!listStarted || items.length === 0) return null;

  const blocks: JSONContent[] = [];
  if (introLines.length > 0) {
    const introText = introLines.join("\n");
    blocks.push(paragraphFromElement(
      Object.assign(document.createElement("p"), { textContent: introText }),
      blockColor,
      blockToken,
      options,
    ));
  }

  const bulletList: JSONContent = {
    type: "bulletList",
    attrs: blockToken ? { blockTextColor: blockToken } : undefined,
    content: items.map((item) => {
      const parts = item.lines.filter(Boolean);
      const paragraphContent: JSONContent[] = [];
      parts.forEach((part, index) => {
        if (index > 0) paragraphContent.push({ type: "hardBreak" });
        paragraphContent.push(...inlineFromNode(document.createTextNode(part), blockToken ? null : blockColor, [], options));
      });
      return {
        type: "listItem",
        content: [{
          type: "paragraph",
          content: paragraphContent.length > 0 ? paragraphContent : [],
        }],
      };
    }),
  };
  blocks.push(bulletList);
  return blocks;
}

function blocksFromContainerChildren(
  container: HTMLElement,
  inheritedBlockColor: string | null = null,
  inheritedBlockToken: string | null = null,
  options?: HtmlToDocOptions,
): JSONContent[] {
  const out: JSONContent[] = [];

  const appendFromNode = (
    node: Node,
    parentBlockColor: string | null,
    parentBlockToken: string | null,
  ) => {
    if (node instanceof HTMLElement) {
      const tag = node.tagName.toLowerCase();
      const classColor = parseColorFromClass(node.className);
      const blockColor =
        parseColorFromStyle(node.getAttribute("style"))
        ?? classColor?.css
        ?? parentBlockColor;
      const blockToken = classColor?.token ?? parentBlockToken;

      if (tag === "p") {
        const paragraphImages = Array.from(node.querySelectorAll("img"))
          .map((img) => imageNodeFromElement(img, options))
          .filter((img): img is JSONContent => !!img);
        if (paragraphImages.length > 0 && (node.textContent ?? "").trim().length === 0) {
          out.push(...paragraphImages);
          return;
        }
        const mediaBlock = maybeMediaBlockFromParagraph(node, options);
        if (mediaBlock) {
          out.push(mediaBlock);
          return;
        }
        const dashList = dashListBlocksFromParagraph(node, blockColor, blockToken, options);
        if (dashList) {
          out.push(...dashList);
        } else {
          out.push(paragraphFromElement(node, blockColor, blockToken, options));
        }
        return;
      }
      if (tag === "details") {
        out.push(toggleFromDetails(node, options, blockColor, blockToken));
        return;
      }
      if (tag === "aside") {
        out.push(calloutFromAside(node));
        return;
      }
      if (tag === "figure" && node.classList.contains("callout")) {
        out.push(calloutFromFigure(node, options));
        return;
      }
      if (tag === "figure" && node.classList.contains("link-to-page")) {
        const anchor = node.querySelector("a[href]");
        const pageMention = anchor instanceof HTMLElement
          ? pageMentionParagraphFromAnchor(anchor, options)
          : null;
        if (pageMention) {
          out.push(pageMention);
          return;
        }
      }
      if (tag === "figure") {
        const figureImage = node.querySelector("img");
        if (figureImage instanceof HTMLElement) {
          const imageNode = imageNodeFromElement(figureImage, options);
          if (imageNode) {
            out.push(imageNode);
            return;
          }
        }
        const figureMedia = node.querySelector("video, source");
        if (figureMedia instanceof HTMLElement) {
          const mediaNode = mediaNodeFromElement(figureMedia, options);
          if (mediaNode) {
            out.push(mediaNode);
            return;
          }
        }
      }
      if (tag === "ul" && node.classList.contains("toggle")) {
        out.push(...togglesFromToggleList(node, options, blockColor, blockToken));
        return;
      }
      if (tag === "ul" || tag === "ol") {
        out.push(listNodeFromElement(node, blockColor, blockToken));
        return;
      }
      if (tag === "div" || tag === "section" || tag === "article") {
        for (const child of Array.from(node.childNodes)) {
          appendFromNode(child, blockColor, blockToken);
        }
        return;
      }
      if (tag === "img") {
        const imageNode = imageNodeFromElement(node, options);
        if (imageNode) out.push(imageNode);
        return;
      }
      if (tag === "video" || tag === "source") {
        const mediaNode = mediaNodeFromElement(node, options);
        if (mediaNode) out.push(mediaNode);
        return;
      }
      const inline = inlineFromNode(node, blockToken ? null : blockColor, [], options);
      if (inline.length > 0) {
        out.push({
          type: "paragraph",
          attrs: blockToken ? { blockTextColor: blockToken } : undefined,
          content: inline,
        });
      }
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent?.trim() ?? "";
      if (!raw) return;
      out.push({ type: "paragraph", content: [{ type: "text", text: raw }] });
    }
  };

  for (const child of Array.from(container.childNodes)) {
    appendFromNode(child, inheritedBlockColor, inheritedBlockToken);
  }

  return out;
}

function paragraphFromElement(
  el: HTMLElement,
  blockColor: string | null,
  blockToken: string | null,
  options?: HtmlToDocOptions,
): JSONContent {
  const inheritedColor = blockToken ? null : blockColor;
  const content = inlineFromNode(el, inheritedColor, [], options);
  return {
    type: "paragraph",
    attrs: blockToken ? { blockTextColor: blockToken } : undefined,
    content: content.length > 0 ? content : [],
  };
}

function headingFromElement(
  el: HTMLElement,
  level: number,
  blockColor: string | null,
  blockToken: string | null,
  options?: HtmlToDocOptions,
): JSONContent {
  const inheritedColor = blockToken ? null : blockColor;
  const content = inlineFromNode(el, inheritedColor, [], options);
  return {
    type: "heading",
    attrs: blockToken ? { level, blockTextColor: blockToken } : { level },
    content: content.length > 0 ? content : [],
  };
}

function calloutFromAside(aside: HTMLElement): JSONContent {
  const classColor = parseColorFromClass(aside.className);
  const blockColor = parseColorFromStyle(aside.getAttribute("style")) ?? classColor?.css ?? null;
  const blockToken = classColor?.token ?? null;
  const blocks = blocksFromContainerChildren(aside, blockColor, blockToken);
  return {
    type: "callout",
    attrs: { preset: "info" },
    content: blocks.length > 0 ? blocks : [{ type: "paragraph", content: [] }],
  };
}

function calloutFromFigure(figure: HTMLElement, options?: HtmlToDocOptions): JSONContent {
  const classColor = parseColorFromClass(figure.className);
  const blockColor = parseColorFromStyle(figure.getAttribute("style")) ?? classColor?.css ?? null;
  const blockToken = classColor?.token ?? null;
  const textContainer = (() => {
    const candidates = Array.from(figure.children).filter(
      (child) => child instanceof HTMLElement && child.tagName.toLowerCase() !== "img",
    ) as HTMLElement[];
    if (candidates.length <= 1) return figure;
    const withMostText = candidates
      .map((node) => ({ node, len: node.textContent?.trim().length ?? 0 }))
      .sort((a, b) => b.len - a.len)[0];
    return withMostText?.node ?? figure;
  })();
  const blocks = blocksFromContainerChildren(textContainer, blockColor, blockToken, options);
  const hasIcon = !!figure.querySelector("img.notion-static-icon");
  return {
    type: "callout",
    attrs: { preset: hasIcon ? "info" : "empty" },
    content: blocks.length > 0 ? blocks : [{ type: "paragraph", content: [] }],
  };
}

function toggleFromDetails(
  details: HTMLElement,
  options?: HtmlToDocOptions,
  inheritedBlockColor: string | null = null,
  inheritedBlockToken: string | null = null,
): JSONContent {
  const summary = details.querySelector(":scope > summary");
  const summaryClassColor = summary ? parseColorFromClass(summary.className) : null;
  const detailsClassColor = parseColorFromClass(details.className);
  const blockToken = summaryClassColor?.token ?? detailsClassColor?.token ?? inheritedBlockToken;
  const summaryInlineColor =
    (summary ? parseColorFromStyle(summary.getAttribute("style")) : null)
    ?? summary?.getAttribute("color")
    ?? summaryClassColor?.css
    ?? parseColorFromStyle(details.getAttribute("style"))
    ?? details.getAttribute("color")
    ?? detailsClassColor?.css
    ?? inheritedBlockColor
    ?? null;
  const headerInline = summary ? inlineFromNode(summary, blockToken ? null : summaryInlineColor, [], options) : [];
  const contentWrapper = details.cloneNode(true) as HTMLElement;
  const clonedSummary = contentWrapper.querySelector("summary");
  if (clonedSummary) clonedSummary.remove();
  const contentBlocks = blocksFromContainerChildren(contentWrapper, null, null, {
    ...options,
    deferPageMentions: true,
  });
  const normalizedContentBlocks = relocateDeferredMentionsInToggleBlocks(contentBlocks);

  return {
    type: "toggle",
    attrs: blockToken
      ? { open: details.hasAttribute("open"), blockTextColor: blockToken }
      : { open: details.hasAttribute("open") },
    content: [
      {
        type: "toggleHeader",
        attrs: blockToken ? { blockTextColor: blockToken } : undefined,
        content: headerInline.length > 0 ? headerInline : [{ type: "text", text: "토글" }],
      },
      {
        type: "toggleContent",
        content: normalizedContentBlocks.length > 0 ? normalizedContentBlocks : [{ type: "paragraph", content: [] }],
      },
    ],
  };
}

function appendBlocksToToggleContent(toggleNode: JSONContent, blocks: JSONContent[]): JSONContent {
  if (!Array.isArray(toggleNode.content) || blocks.length === 0) return toggleNode;
  const idx = toggleNode.content.findIndex((node) => node.type === "toggleContent");
  if (idx < 0) return toggleNode;
  const contentNode = toggleNode.content[idx];
  if (!contentNode) return toggleNode;
  const nextContent = [...toggleNode.content];
  nextContent[idx] = {
    ...contentNode,
    content: [...(contentNode.content ?? []), ...blocks],
  };
  return { ...toggleNode, content: nextContent };
}

function togglesFromToggleList(
  toggleListEl: HTMLElement,
  options?: HtmlToDocOptions,
  inheritedBlockColor: string | null = null,
  inheritedBlockToken: string | null = null,
): JSONContent[] {
  const classColor = parseColorFromClass(toggleListEl.className);
  const blockColor =
    parseColorFromStyle(toggleListEl.getAttribute("style"))
    ?? classColor?.css
    ?? inheritedBlockColor;
  const blockToken = classColor?.token ?? inheritedBlockToken;
  const out: JSONContent[] = [];
  const liNodes = Array.from(toggleListEl.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.tagName.toLowerCase() === "li",
  );
  for (const li of liNodes) {
    const details = li.querySelector(":scope > details");
    if (!(details instanceof HTMLElement)) continue;
    let toggleNode = toggleFromDetails(details, options, blockColor, blockToken);
    const extraWrapper = document.createElement("div");
    for (const child of Array.from(li.childNodes)) {
      if (child === details) continue;
      extraWrapper.appendChild(child.cloneNode(true));
    }
    const extraBlocks = blocksFromContainerChildren(extraWrapper, null, null, options);
    if (extraBlocks.length > 0) {
      toggleNode = appendBlocksToToggleContent(toggleNode, extraBlocks);
    }
    out.push(toggleNode);
  }
  return out;
}

function tableFromElement(table: HTMLElement): JSONContent {
  const rows: JSONContent[] = [];
  const trNodes = Array.from(table.querySelectorAll("tr"));
  trNodes.forEach((tr) => {
    const cells: JSONContent[] = [];
    const cellNodes = Array.from(tr.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        (child.tagName.toLowerCase() === "th" || child.tagName.toLowerCase() === "td"),
    );

    cellNodes.forEach((cell) => {
      const cellContent = inlineFromNode(cell, null, []);
      const paragraph: JSONContent = {
        type: "paragraph",
        content: cellContent.length > 0 ? cellContent : [],
      };
      cells.push({
        type: cell.tagName.toLowerCase() === "th" ? "tableHeader" : "tableCell",
        content: [paragraph],
      });
    });

    rows.push({
      type: "tableRow",
      content: cells,
    });
  });

  return {
    type: "table",
    content: rows.length > 0 ? rows : [{ type: "tableRow", content: [] }],
  };
}

export type NotionCollectionTable = {
  headers: string[];
  rows: Array<{
    cells: string[];
    titleLinkPath: string | null;
    cellMeta: Array<{
      hasTimeTag: boolean;
      statusColorToken: string | null;
      statusLike: boolean;
    }>;
  }>;
};

type HtmlToDocOptions = {
  onCollectionTable?: (table: NotionCollectionTable) => string;
  resolveImageSrc?: (src: string) => string | null;
  resolveImageNode?: (src: string, element: HTMLElement) => JSONContent | null;
  resolveMediaNode?: (src: string, element: HTMLElement) => JSONContent | null;
  iconReplacementText?: string;
  currentPagePath?: string;
  resolvePageMentionByHref?: (href: string) => { pageId: string; label?: string } | null;
  deferPageMentions?: boolean;
};

const DEFERRED_PAGE_MENTION_PREFIX = "__QN_PM__";

function createDeferredMentionToken(pageId: string, label: string): string {
  return `${DEFERRED_PAGE_MENTION_PREFIX}${encodeURIComponent(pageId)}::${encodeURIComponent(label)}__`;
}

function parseDeferredMentionToken(token: string): { pageId: string; label: string } | null {
  if (!token.startsWith(DEFERRED_PAGE_MENTION_PREFIX) || !token.endsWith("__")) return null;
  const raw = token.slice(DEFERRED_PAGE_MENTION_PREFIX.length, -2);
  const sepIdx = raw.indexOf("::");
  if (sepIdx <= 0) return null;
  const pageId = decodeURIComponent(raw.slice(0, sepIdx));
  const label = decodeURIComponent(raw.slice(sepIdx + 2));
  if (!pageId) return null;
  return { pageId, label: label || "페이지" };
}

function createPageMentionParagraph(pageId: string, label: string): JSONContent {
  return {
    type: "paragraph",
    content: [{
      type: "mention",
      attrs: {
        id: `p:${pageId}`,
        label,
        mentionKind: "page",
      },
    }],
  };
}

function pageMentionParagraphFromAnchor(anchor: HTMLElement, options?: HtmlToDocOptions): JSONContent | null {
  const href = anchor.getAttribute("href") ?? "";
  const pageMention = options?.resolvePageMentionByHref?.(href);
  if (!pageMention?.pageId) return null;
  const labelText = (anchor.textContent ?? "").trim();
  const label = pageMention.label ?? labelText ?? "페이지";
  if (options?.deferPageMentions) {
    return {
      type: "paragraph",
      content: [textNode(createDeferredMentionToken(pageMention.pageId, label))],
    };
  }
  return createPageMentionParagraph(pageMention.pageId, label);
}

function relocateDeferredMentionsInToggleBlocks(blocks: JSONContent[]): JSONContent[] {
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

function resolveRelativePath(basePath: string, href: string): string {
  const baseParts = basePath.split("/").slice(0, -1);
  const hrefParts = href.split("/");
  for (const part of hrefParts) {
    if (!part || part === ".") continue;
    if (part === "..") baseParts.pop();
    else baseParts.push(part);
  }
  return baseParts.join("/");
}

function inlineFromNode(node: Node, inheritedColor: string | null, inheritedMarks: NonNullable<JSONContent["marks"]>, options?: HtmlToDocOptions): JSONContent[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const raw = node.textContent ?? "";
    if (!raw) return [];
    const marks = [...inheritedMarks];
    if (inheritedColor) {
      marks.push({ type: "textStyle", attrs: { color: inheritedColor } });
    }
    if (marks.some((m) => m.type === "link")) {
      if (isLikelyUrlText(raw)) {
        return [textNode(summarizeImportedLinkText(raw), marks.length > 0 ? marks : undefined)];
      }
      return [textNode(raw, marks.length > 0 ? marks : undefined)];
    }
    return textNodesWithAutoLinks(raw, marks);
  }

  if (!(node instanceof HTMLElement)) return [];

  const classColor = parseColorFromClass(node.className);
  const selfColor = parseColorFromStyle(node.getAttribute("style"))
    ?? node.getAttribute("color")
    ?? classColor?.css
    ?? null;
  const nextColor = selfColor ?? inheritedColor;

  let nextMarks: NonNullable<JSONContent["marks"]> = [...inheritedMarks];
  const tag = node.tagName.toLowerCase();
  if (tag === "br") return [{ type: "hardBreak" }];
  if (tag === "img") {
    const isStaticIcon = node.classList.contains("notion-static-icon") || node.classList.contains("icon");
    if (isStaticIcon) {
      return [{ type: "text", text: options?.iconReplacementText ?? "▪︎" }];
    }
    return [];
  }
  if (tag === "video" || tag === "source") return [];
  if (tag === "strong" || tag === "b") nextMarks = mergeMarks(nextMarks, [{ type: "bold" }]);
  if (tag === "em" || tag === "i") nextMarks = mergeMarks(nextMarks, [{ type: "italic" }]);
  if (tag === "code") nextMarks = mergeMarks(nextMarks, [{ type: "code" }]);
  if (tag === "a") {
    const href = node.getAttribute("href") ?? "";
    const pageMention = options?.resolvePageMentionByHref?.(href);
    if (pageMention?.pageId) {
      const labelText = (node.textContent ?? "").trim();
      if (options?.deferPageMentions) {
        return [textNode(createDeferredMentionToken(pageMention.pageId, pageMention.label ?? labelText ?? "페이지"))];
      }
      return [{
        type: "mention",
        attrs: {
          id: `p:${pageMention.pageId}`,
          label: pageMention.label ?? labelText ?? "페이지",
          mentionKind: "page",
        },
      }];
    }
    const normalizedHref = normalizeImportedLinkHref(href);
    if (normalizedHref) {
      nextMarks = mergeMarks(nextMarks, [{ type: "link", attrs: { href: normalizedHref, target: "_blank", rel: "noopener noreferrer nofollow" } }]);
    }
  }
  for (const cls of node.className.split(/\s+/).filter(Boolean)) {
    const bg = HIGHLIGHT_BG_COLOR_MAP[cls];
    if (!bg) continue;
    nextMarks = mergeMarks(nextMarks, [{ type: "highlight", attrs: { color: bg } }]);
  }

  const out: JSONContent[] = [];
  for (const child of Array.from(node.childNodes)) {
    out.push(...inlineFromNode(child, nextColor, nextMarks, options));
  }
  return out;
}

function bookmarkBlockFromAnchor(anchor: HTMLElement): JSONContent | null {
  const href = anchor.getAttribute("href") ?? "";
  const normalizedHref = normalizeImportedLinkHref(href);
  if (!normalizedHref) return null;
  const label = (anchor.textContent ?? "").trim();
  return {
    type: "bookmarkBlock",
    attrs: {
      href: normalizedHref,
      title: label,
      description: "",
      siteName: "",
      imageUrl: "",
      status: "loading",
    },
  };
}

function maybeBookmarkBlockFromParagraph(el: HTMLElement, options?: HtmlToDocOptions): JSONContent | null {
  const anchors = Array.from(el.querySelectorAll("a[href]")).filter(
    (a): a is HTMLElement => a instanceof HTMLElement,
  );
  if (anchors.length !== 1) return null;
  const anchor = anchors[0];
  if (!anchor) return null;
  const href = anchor.getAttribute("href") ?? "";
  if (options?.resolvePageMentionByHref?.(href)) return null;
  const paragraphText = (el.textContent ?? "").trim().replace(/\s+/g, " ");
  const anchorText = (anchor.textContent ?? "").trim().replace(/\s+/g, " ");
  if (!paragraphText || paragraphText !== anchorText) return null;
  return bookmarkBlockFromAnchor(anchor);
}

function maybeMediaBlockFromParagraph(el: HTMLElement, options?: HtmlToDocOptions): JSONContent | null {
  const anchors = Array.from(el.querySelectorAll("a[href]")).filter(
    (a): a is HTMLElement => a instanceof HTMLElement,
  );
  if (anchors.length !== 1) return null;
  const anchor = anchors[0];
  if (!anchor) return null;
  const href = anchor.getAttribute("href") ?? "";
  if (options?.resolvePageMentionByHref?.(href)) return null;
  const paragraphText = (el.textContent ?? "").trim().replace(/\s+/g, " ");
  const anchorText = (anchor.textContent ?? "").trim().replace(/\s+/g, " ");
  if (!paragraphText || paragraphText !== anchorText) return null;
  return options?.resolveMediaNode?.(href, anchor) ?? options?.resolveImageNode?.(href, anchor) ?? null;
}

function notionHtmlToDocInternal(html: string, options?: HtmlToDocOptions): JSONContent {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const page = doc.querySelector("article.page") ?? doc.body;
  const blocks: JSONContent[] = [];

  const elements = Array.from(page.querySelectorAll("details, table, h1, h2, h3, p, ul, ol, aside, figure.callout, figure.bookmark, figure, hr, img, video"));
  for (const el of elements) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.closest("header") && el.tagName.toLowerCase() !== "h1") continue;
    if (el.tagName.toLowerCase() !== "figure" && el.closest("figure.callout")) continue;

    const tag = el.tagName.toLowerCase();
    if (tag === "details" && el.closest("ul.toggle")) continue;
    if (tag === "details" && el.parentElement?.closest("details")) continue;
    if (tag !== "details" && el.closest("details")) continue;
    const classColor = parseColorFromClass(el.className);
    const blockColor = parseColorFromStyle(el.getAttribute("style")) ?? classColor?.css ?? null;
    const blockToken = classColor?.token ?? null;
    if (tag === "ul" && el.classList.contains("toggle")) {
      blocks.push(...togglesFromToggleList(el, options, blockColor, blockToken));
      continue;
    }
    if (tag === "li" && el.closest("ul.toggle")) continue;
    if ((tag === "ul" || tag === "ol") && el.closest("li")) continue;
    if (tag === "p" && el.closest("li")) continue;

    if (tag === "details") {
      blocks.push(toggleFromDetails(el, options, blockColor, blockToken));
      continue;
    }
    if (tag === "table") {
      if (el.classList.contains("collection-content") && options?.onCollectionTable) {
        const trNodes = Array.from(el.querySelectorAll("tr"));
        const headers: string[] = [];
        const rows: NotionCollectionTable["rows"] = [];
        trNodes.forEach((tr, idx) => {
          const cells = Array.from(tr.children).filter(
            (child): child is HTMLElement =>
              child instanceof HTMLElement &&
              (child.tagName.toLowerCase() === "th" || child.tagName.toLowerCase() === "td"),
          );
          const texts = cells.map((c) => (c.textContent ?? "").trim().replace(/\s+/g, " "));
          if (idx === 0) headers.push(...texts);
          else if (texts.length > 0) {
            const anchor = cells[0]?.querySelector("a[href]");
            const href = anchor?.getAttribute("href") ?? null;
            const titleLinkPath = href && options?.currentPagePath
              ? resolveRelativePath(options.currentPagePath, decodeURIComponent(href))
              : href ? decodeURIComponent(href) : null;
            const cellMeta = cells.map((cell) => {
              const timeNode = cell.querySelector("time");
              const statusNode = cell.querySelector("[class*='select-value-color-'], [class*='status-value-color-']");
              const statusClassSource = `${cell.className} ${statusNode?.className ?? ""}`;
              const statusClass = statusClassSource
                .split(/\s+/)
                .find((cls) => cls.startsWith("select-value-color-") || cls.startsWith("status-value-color-"));
              const statusColorToken = statusClass
                ? statusClass.replace("select-value-color-", "").replace("status-value-color-", "")
                : null;
              return {
                hasTimeTag: !!timeNode,
                statusColorToken,
                statusLike: !!statusClass || !!cell.querySelector(".property-select, .property-status"),
              };
            });
            rows.push({ cells: texts, titleLinkPath, cellMeta });
          }
        });
        const databaseId = options.onCollectionTable({ headers, rows });
        blocks.push({
          type: "databaseBlock",
          attrs: {
            databaseId,
            layout: "inline",
            view: "table",
            panelState: JSON.stringify(emptyPanelState()),
            readOnlyTitle: false,
          },
        });
        continue;
      }
      blocks.push(tableFromElement(el));
      continue;
    }
    if (tag === "h1") {
      if (el.classList.contains("page-title")) continue;
      blocks.push(headingFromElement(el, 1, blockColor, blockToken, options));
      continue;
    }
    if (tag === "h2") {
      blocks.push(headingFromElement(el, 2, blockColor, blockToken, options));
      continue;
    }
    if (tag === "h3") {
      blocks.push(headingFromElement(el, 3, blockColor, blockToken, options));
      continue;
    }
    if (tag === "p") {
      const paragraphImages = Array.from(el.querySelectorAll("img"))
        .map((img) => imageNodeFromElement(img, options))
        .filter((img): img is JSONContent => !!img);
      if (paragraphImages.length > 0 && (el.textContent ?? "").trim().length === 0) {
        blocks.push(...paragraphImages);
        continue;
      }
      const mediaBlock = maybeMediaBlockFromParagraph(el, options);
      if (mediaBlock) {
        blocks.push(mediaBlock);
        continue;
      }
      const bookmark = maybeBookmarkBlockFromParagraph(el, options);
      if (bookmark) {
        blocks.push(bookmark);
      } else {
        const dashList = dashListBlocksFromParagraph(el, blockColor, blockToken, options);
        if (dashList) {
          blocks.push(...dashList);
        } else {
          blocks.push(paragraphFromElement(el, blockColor, blockToken, options));
        }
      }
      continue;
    }
    if (tag === "aside") {
      blocks.push(calloutFromAside(el));
      continue;
    }
    if (tag === "figure" && el.classList.contains("callout")) {
      blocks.push(calloutFromFigure(el, options));
      continue;
    }
    if (tag === "figure" && el.classList.contains("link-to-page")) {
      const anchor = el.querySelector("a[href]");
      const pageMention = anchor instanceof HTMLElement
        ? pageMentionParagraphFromAnchor(anchor, options)
        : null;
      if (pageMention) {
        blocks.push(pageMention);
        continue;
      }
    }
    if (tag === "figure" && el.classList.contains("bookmark")) {
      const anchor = el.querySelector("a[href]");
      if (anchor instanceof HTMLElement) {
        const bookmark = bookmarkBlockFromAnchor(anchor);
        if (bookmark) {
          blocks.push(bookmark);
          continue;
        }
      }
    }
    if (tag === "figure") {
      const figureImage = el.querySelector("img");
      if (figureImage instanceof HTMLElement) {
        const imageNode = imageNodeFromElement(figureImage, options);
        if (imageNode) {
          blocks.push(imageNode);
          continue;
        }
      }
      const figureMedia = el.querySelector("video, source");
      if (figureMedia instanceof HTMLElement) {
        const mediaNode = mediaNodeFromElement(figureMedia, options);
        if (mediaNode) {
          blocks.push(mediaNode);
          continue;
        }
      }
    }
    if (tag === "img") {
      const imageNode = imageNodeFromElement(el, options);
      if (imageNode) {
        blocks.push(imageNode);
        continue;
      }
    }
    if (tag === "video") {
      const mediaNode = mediaNodeFromElement(el, options);
      if (mediaNode) {
        blocks.push(mediaNode);
        continue;
      }
    }
    if (tag === "hr") {
      blocks.push({ type: "horizontalRule" });
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      blocks.push(listNodeFromElement(el, blockColor, blockToken));
    }
  }

  return {
    type: "doc",
    content: blocks.length > 0 ? blocks : [{ type: "paragraph", content: [] }],
  };
}

export function notionHtmlToDoc(html: string, options?: HtmlToDocOptions): JSONContent {
  return notionHtmlToDocInternal(html, options);
}
