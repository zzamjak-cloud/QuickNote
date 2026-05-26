import type { JSONContent } from "@tiptap/react";
import { emptyPanelState } from "../../types/database";
import {
  isLikelyUrlText,
  normalizeImportedLinkHref,
  summarizeImportedLinkText,
} from "./linkUtils";
import {
  HIGHLIGHT_BG_COLOR_MAP,
  parseColorFromStyle,
  parseColorFromClass,
  parseBlockBgFromClass,
} from "./htmlToDoc/colors";
import {
  createDeferredMentionToken,
  parseDeferredMentionToken,
  createPageMentionParagraph,
  pageMentionParagraphFromAnchor,
} from "./htmlToDoc/pageMentions";

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

// li 내부에서 별도 블록(이미지/동영상/표/콜아웃/컬럼 등) 으로 끌어올릴 자손 셀렉터.
// 노션은 글머리 항목 안에 이미지·동영상 블록을 자유롭게 배치할 수 있지만, 기존 변환기는
// li 의 자식 노드를 inlineFromNode 만 거치게 해 이런 블록 콘텐츠가 모두 사라졌다.
const LI_BLOCK_CHILD_SELECTOR =
  "figure, img, video, table, hr, pre, blockquote, details, aside, h1, h2, h3, h4, h5, h6, iframe, div.column-list";

function listNodeFromElement(
  el: HTMLElement,
  blockColor: string | null,
  blockToken: string | null,
  options?: HtmlToDocOptions,
): JSONContent {
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
      nestedBlocks.push(listNodeFromElement(nestedList, blockColor, blockToken, options));
    }

    // li 의 직속(또는 wrapper p 등으로 한 단계 감싸진) 블록 콘텐츠 — 이미지/동영상/표/콜아웃/컬럼 등 —
    // 을 별도 블록으로 추출해 listItem 본문 뒤에 첨부한다.
    // 동일 자손이 inline 추출 단계에서 텍스트로 평탄화되지 않도록 clone 에서도 제거한다.
    const extractedBlockEls: HTMLElement[] = [];
    for (const child of Array.from(li.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.tagName.toLowerCase() === "ul" || child.tagName.toLowerCase() === "ol") continue;
      if (child.matches(LI_BLOCK_CHILD_SELECTOR)) {
        extractedBlockEls.push(child);
        continue;
      }
      // <p><figure>…</figure></p> 처럼 한 단계 감싸진 케이스도 끌어올린다.
      const wrappedBlock = child.querySelector(":scope > " + LI_BLOCK_CHILD_SELECTOR);
      if (wrappedBlock instanceof HTMLElement && !child.querySelector("ul, ol")) {
        extractedBlockEls.push(child);
      }
    }
    const blockChildJsonNodes: JSONContent[] = [];
    if (extractedBlockEls.length > 0 && options) {
      const wrappedHtml = `<article class="page">${extractedBlockEls
        .map((b) => b.outerHTML)
        .join("")}</article>`;
      const innerDoc = notionHtmlToDocInternal(wrappedHtml, options);
      const innerContent = Array.isArray(innerDoc.content) ? (innerDoc.content as JSONContent[]) : [];
      for (const n of innerContent) blockChildJsonNodes.push(n);
    }

    const liClone = li.cloneNode(true) as HTMLElement;
    for (const nested of Array.from(liClone.querySelectorAll("ul, ol"))) {
      nested.remove();
    }
    // 블록으로 끌어올린 자식들은 inline 추출 대상에서 제거.
    for (const c of Array.from(liClone.children)) {
      if (!(c instanceof HTMLElement)) continue;
      if (c.matches(LI_BLOCK_CHILD_SELECTOR)) c.remove();
      else if (c.querySelector(":scope > " + LI_BLOCK_CHILD_SELECTOR) && !c.querySelector("ul, ol")) c.remove();
    }
    for (const child of Array.from(liClone.childNodes)) {
      paragraphInlines.push(...inlineFromNode(child, blockToken ? null : blockColor, []));
    }

    // 노션은 항목별 배경색을 <li> 클래스로 내보낸다. 퀵노트 listItem 도 backgroundColor 속성을 지원.
    const liBgToken = parseBlockBgFromClass(li.className);
    const listItemContent: JSONContent[] = [{
      type: "paragraph",
      content: paragraphInlines.length > 0 ? paragraphInlines : [],
    }];
    listItemContent.push(...blockChildJsonNodes);
    listItemContent.push(...nestedBlocks);
    items.push({
      type: "listItem",
      attrs: liBgToken ? { backgroundColor: liBgToken } : undefined,
      content: listItemContent,
    });
  }

  // Notion 은 번호 목록의 각 항목을 별도의 <ol start="N"> 으로 내보내는 경우가 많다.
  // start 속성을 그대로 사용해야 1, 2, 3 ... 으로 정확히 표시된다.
  // (start 를 항상 1 로 고정하면 모든 항목이 "1." 로만 표시되는 회귀가 발생한다)
  const startRaw = isOrdered ? el.getAttribute("start") : null;
  const startNum = startRaw && /^\d+$/.test(startRaw) ? Math.max(1, parseInt(startRaw, 10)) : 1;
  return {
    type: isOrdered ? "orderedList" : "bulletList",
    attrs: isOrdered
      ? blockToken
        ? { start: startNum, blockTextColor: blockToken }
        : { start: startNum }
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
        const mediaBlock = maybeMediaBlockFromParagraph(node, options);
        if (mediaBlock) {
          out.push(mediaBlock);
          return;
        }
        const bookmark = maybeBookmarkBlockFromParagraph(node, options);
        if (bookmark) {
          out.push(bookmark);
          return;
        }
        const paragraphImages = Array.from(node.querySelectorAll("img"))
          .map((img) => imageNodeFromElement(img, options))
          .filter((img): img is JSONContent => !!img);
        if (paragraphImages.length > 0 && (node.textContent ?? "").trim().length === 0) {
          out.push(...paragraphImages);
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
      // 콜아웃·토글 등 컨테이너 내부에 인라인 DB(collection-content) 가 있는 경우,
      // 메인 흐름의 collection-content 변환 로직을 재사용해 databaseBlock 으로 변환.
      // (이전에는 이 브랜치가 없어 콜아웃 내부에 인라인 DB 를 임포트하지 못했음)
      if (tag === "table" && node.classList.contains("collection-content") && options?.onCollectionTable) {
        const wrapped = `<article class="page">${node.outerHTML}</article>`;
        const innerDoc = notionHtmlToDocInternal(wrapped, options);
        const innerBlocks = Array.isArray(innerDoc.content) ? (innerDoc.content as JSONContent[]) : [];
        for (const b of innerBlocks) out.push(b);
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
        const yt = youtubeNodeFromElement(node);
        if (yt) {
          out.push(yt);
          return;
        }
        // 북마크 구조 가 있으면 이미지/임베드 추출보다 우선해서 북마크 블록으로 변환.
        if (hasBookmarkStructure(node)) {
          const bAnchor = node.querySelector("a[href]");
          if (bAnchor instanceof HTMLElement) {
            const bookmark = bookmarkBlockFromAnchor(bAnchor, node);
            if (bookmark) {
              out.push(bookmark);
              return;
            }
          }
        }
        if (node.classList.contains("image")) {
          const figureImage = node.querySelector("img");
          if (figureImage instanceof HTMLElement) {
            const imageNode = imageNodeFromElement(figureImage, options);
            if (imageNode) {
              out.push(imageNode);
              return;
            }
          }
        }
        const sourceAnchor = node.querySelector(".source a[href], a[href]");
        if (sourceAnchor instanceof HTMLElement) {
          const assetNode = assetBlockFromAnchor(sourceAnchor, options);
          if (assetNode) {
            out.push(assetNode);
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
        // bookmark / 일반 임베드
        if (node.classList.contains("bookmark") || node.querySelector("a[href]")) {
          const a = node.querySelector("a[href]");
          if (a instanceof HTMLElement) {
            const bookmark = bookmarkBlockFromAnchor(a, node);
            if (bookmark) {
              out.push(bookmark);
              return;
            }
          }
        }
      }
      if (tag === "ul" && node.classList.contains("toggle")) {
        out.push(...togglesFromToggleList(node, options, blockColor, blockToken));
        return;
      }
      if (tag === "blockquote") {
        out.push(blockquoteFromElement(node, blockColor, blockToken, options));
        return;
      }
      if (tag === "pre") {
        out.push(codeBlockFromElement(node));
        return;
      }
      if (tag === "iframe") {
        const yt = youtubeNodeFromUrl(node.getAttribute("src") ?? "");
        if (yt) out.push(yt);
        return;
      }
      if (tag === "ul" || tag === "ol") {
        out.push(listNodeFromElement(node, blockColor, blockToken, options));
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
  const bgToken = parseBlockBgFromClass(el.className);
  const attrs: Record<string, unknown> = {};
  if (blockToken) attrs.blockTextColor = blockToken;
  if (bgToken) attrs.backgroundColor = bgToken;
  return {
    type: "paragraph",
    attrs: Object.keys(attrs).length > 0 ? attrs : undefined,
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
  const bgToken = parseBlockBgFromClass(el.className);
  const attrs: Record<string, unknown> = { level };
  if (blockToken) attrs.blockTextColor = blockToken;
  if (bgToken) attrs.backgroundColor = bgToken;
  return {
    type: "heading",
    attrs,
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

function codeBlockFromElement(pre: HTMLElement): JSONContent {
  const codeEl = pre.querySelector("code");
  const rawText = (codeEl?.textContent ?? pre.textContent ?? "").replace(/\r\n/g, "\n");
  const languageClass = (codeEl?.className ?? pre.className)
    .split(/\s+/)
    .find((cls) => cls.startsWith("language-"));
  const language = languageClass?.replace(/^language-/, "") || null;
  return {
    type: "codeBlock",
    attrs: language ? { language } : undefined,
    content: rawText.length > 0 ? [{ type: "text", text: rawText }] : [],
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
      // 다중 선택 옵션 개수 (1 = single-select, 2+ = multi-select)
      selectedCount: number;
      // 선택된 옵션들 + 각각의 색 토큰
      selectedOptions: Array<{ label: string; colorToken: string | null }>;
      // 사람 속성 (Notion .user / .notion-user / role 아이콘)
      hasPerson: boolean;
      personNames: string[];
    }>;
  }>;
};

type HtmlToDocOptions = {
  onCollectionTable?: (table: NotionCollectionTable) => string | null;
  resolveImageSrc?: (src: string) => string | null;
  resolveImageNode?: (src: string, element: HTMLElement) => JSONContent | null;
  resolveMediaNode?: (src: string, element: HTMLElement) => JSONContent | null;
  iconReplacementText?: string;
  currentPagePath?: string;
  resolvePageMentionByHref?: (href: string) => { pageId: string; label?: string } | null;
  deferPageMentions?: boolean;
};

// 페이지 멘션 헬퍼는 htmlToDoc/pageMentions.ts 로 이동.

function assetBlockFromAnchor(anchor: HTMLElement, options?: HtmlToDocOptions): JSONContent | null {
  const href = anchor.getAttribute("href") ?? "";
  if (!href) return null;
  if (options?.resolvePageMentionByHref?.(href)) return null;
  return options?.resolveMediaNode?.(href, anchor) ?? options?.resolveImageNode?.(href, anchor) ?? null;
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
    // 같은 항목(li) 안에 동일 지도 링크의 figure 북마크가 함께 있을 때만
    // 인라인 지도 링크를 제거해 중복 표시를 막는다.
    if (isMapLinkHref(href) && hasDuplicateMapBookmarkAnchor(node)) return [];
    const normalizedHref = normalizeImportedLinkHref(href);
    if (normalizedHref) {
      nextMarks = mergeMarks(nextMarks, [{ type: "link", attrs: { href: normalizedHref, target: "_blank", rel: "noopener noreferrer nofollow" } }]);
    }
  }
  // 블록 단위 요소(p/h*/li/blockquote 등) 의 배경색은 paragraphFromElement / headingFromElement /
  // listNodeFromElement / blockquoteFromElement 에서 블록 속성(backgroundColor) 으로 변환된다.
  // 여기서는 인라인 형광펜(span 등) 에만 highlight 마크를 적용해 중복을 막는다.
  const isBlockLevelTag = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "ul", "ol", "blockquote", "details", "summary", "div", "section", "article"].includes(tag);
  if (!isBlockLevelTag) {
    for (const cls of node.className.split(/\s+/).filter(Boolean)) {
      const bg = HIGHLIGHT_BG_COLOR_MAP[cls];
      if (!bg) continue;
      nextMarks = mergeMarks(nextMarks, [{ type: "highlight", attrs: { color: bg } }]);
    }
  }

  const out: JSONContent[] = [];
  for (const child of Array.from(node.childNodes)) {
    out.push(...inlineFromNode(child, nextColor, nextMarks, options));
  }
  return out;
}

// YouTube URL → videoId 추출 (watch?v=, youtu.be/, embed/, shorts/, live/ 모두 지원)
function extractYoutubeVideoId(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
    /youtube-nocookie\.com\/embed\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/live\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/v\/([A-Za-z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = trimmed.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

function youtubeNodeFromUrl(url: string): JSONContent | null {
  const videoId = extractYoutubeVideoId(url);
  if (!videoId) return null;
  return {
    type: "youtube",
    attrs: {
      src: `https://www.youtube.com/watch?v=${videoId}`,
    },
  };
}

// figure 내부의 youtube 링크/iframe 탐지
function youtubeNodeFromElement(el: HTMLElement): JSONContent | null {
  const iframe = el.querySelector("iframe[src]");
  if (iframe instanceof HTMLElement) {
    const src = iframe.getAttribute("src") ?? "";
    const node = youtubeNodeFromUrl(src);
    if (node) return node;
  }
  const anchors = Array.from(el.querySelectorAll("a[href]"));
  for (const a of anchors) {
    if (!(a instanceof HTMLElement)) continue;
    const node = youtubeNodeFromUrl(a.getAttribute("href") ?? "");
    if (node) return node;
  }
  return null;
}

// blockquote → tiptap blockquote 노드 (내부에 paragraph(s) 포함)
function blockquoteFromElement(
  el: HTMLElement,
  blockColor: string | null,
  blockToken: string | null,
  options?: HtmlToDocOptions,
): JSONContent {
  const inner: JSONContent[] = [];
  // p 자식이 있으면 각각 paragraph로 변환, 없으면 blockquote 자체 텍스트를 단일 paragraph로 처리
  const childPs = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === "p");
  if (childPs.length > 0) {
    for (const p of childPs) {
      if (p instanceof HTMLElement) {
        inner.push(paragraphFromElement(p, blockColor, blockToken, options));
      }
    }
  } else {
    inner.push(paragraphFromElement(el, blockColor, blockToken, options));
  }
  const bgToken = parseBlockBgFromClass(el.className);
  return {
    type: "blockquote",
    attrs: bgToken ? { backgroundColor: bgToken } : undefined,
    content: inner.length > 0 ? inner : [{ type: "paragraph", content: [] }],
  };
}

/**
 * Notion 의 figure 가 북마크 구조(.bookmark-title / .bookmark-description / .bookmark-href / .bookmark-image)
 * 를 포함하는지 검사. class="bookmark" 가 없는 경우에도 이 구조면 북마크로 우선 변환해야
 * 내부 이미지가 단독 image 블록으로 추출되어 버리는 회귀를 막을 수 있다.
 */
function hasBookmarkStructure(figure: HTMLElement): boolean {
  if (figure.classList.contains("bookmark")) return true;
  return !!figure.querySelector(".bookmark-title, .bookmark-description, .bookmark-href, .bookmark-info");
}

function bookmarkBlockFromAnchor(anchor: HTMLElement, container?: HTMLElement | null): JSONContent | null {
  const href = anchor.getAttribute("href") ?? "";
  const normalizedHref = normalizeImportedLinkHref(href);
  if (!normalizedHref) return null;
  const scope: HTMLElement = container ?? anchor;
  // Notion bookmark 구조 — .bookmark-title / .bookmark-description / .bookmark-image / .bookmark-icon
  const titleEl = scope.querySelector(".bookmark-title");
  const descEl = scope.querySelector(".bookmark-description");
  const hrefEl = scope.querySelector(".bookmark-href");
  const imgEl = scope.querySelector("img.bookmark-image") || scope.querySelector("img.bookmark-icon");
  const title = (titleEl?.textContent ?? "").trim()
    || (anchor.textContent ?? "").trim().split(/\s{2,}|\n/)[0]
    || normalizedHref;
  const description = (descEl?.textContent ?? "").trim();
  const siteName = (hrefEl?.textContent ?? "").trim();
  const imageUrl = imgEl instanceof HTMLElement ? (imgEl.getAttribute("src") ?? "") : "";
  // Notion HTML 에서 추출한 메타가 빈약하면 (제목 없음 또는 이미지/설명 모두 빈 경우)
  // status 를 "loading" 으로 두어 NodeView 가 /api/bookmark 로 라이브 메타 보강을 트리거하도록 함.
  // 충분한 메타가 있으면 "ready" 로 유지해 불필요한 백엔드 호출을 막는다.
  const hasMeaningfulMeta =
    (title && title !== normalizedHref) &&
    (description.length > 0 || imageUrl.length > 0 || siteName.length > 0);
  return {
    type: "bookmarkBlock",
    attrs: {
      href: normalizedHref,
      title,
      description,
      siteName,
      imageUrl,
      status: hasMeaningfulMeta ? "ready" : "loading",
    },
  };
}

function isMapLinkHref(href: string): boolean {
  const normalized = normalizeImportedLinkHref(href);
  if (!normalized) return false;
  try {
    const url = new URL(normalized);
    const host = url.hostname.toLowerCase();
    if (host === "map.naver.com" || host.endsWith(".map.naver.com")) return true;
    if (host === "maps.app.goo.gl") return true;
    return host.includes("google.") && url.pathname.startsWith("/maps");
  } catch {
    return false;
  }
}

function hasDuplicateMapBookmarkAnchor(anchor: HTMLElement): boolean {
  const href = anchor.getAttribute("href") ?? "";
  const normalizedHref = normalizeImportedLinkHref(href);
  if (!normalizedHref || !isMapLinkHref(normalizedHref)) return false;
  const listItem = anchor.closest("li");
  if (!listItem) return false;
  const figureAnchors = Array.from(listItem.querySelectorAll("figure a[href]")).filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  );
  return figureAnchors.some((fa) => {
    if (fa === anchor) return false;
    const figureHref = normalizeImportedLinkHref(fa.getAttribute("href") ?? "");
    return !!figureHref && figureHref === normalizedHref;
  });
}

function mapBookmarkBlockFromAnchor(anchor: HTMLElement, container?: HTMLElement | null): JSONContent | null {
  const href = anchor.getAttribute("href") ?? "";
  if (!isMapLinkHref(href)) return null;
  const normalizedHref = normalizeImportedLinkHref(href);
  if (!normalizedHref) return null;
  const scope = container ?? anchor;
  const rawText = (scope.textContent ?? "").replace(/\s+/g, " ").trim();
  const cleaned = rawText
    .replace(/네이버\s*지도/gi, "")
    .replace(/google\s*maps?/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[•·\-–—>\u2192]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const title = cleaned || (anchor.textContent ?? "").trim() || "지도";
  const siteName = normalizedHref.includes("naver.com") ? "네이버 지도" : "Google 지도";
  const imageEl = scope.querySelector("img.bookmark-image, img.bookmark-icon, img");
  const imageUrl = imageEl instanceof HTMLElement ? (imageEl.getAttribute("src") ?? "") : "";
  return {
    type: "bookmarkBlock",
    attrs: {
      href: normalizedHref,
      title,
      description: normalizedHref,
      siteName,
      imageUrl,
      status: "ready",
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
  const mapBookmark = mapBookmarkBlockFromAnchor(anchor, el);
  if (mapBookmark) return mapBookmark;
  const paragraphText = (el.textContent ?? "").trim().replace(/\s+/g, " ");
  const anchorText = (anchor.textContent ?? "").trim().replace(/\s+/g, " ");
  if (!paragraphText || paragraphText !== anchorText) return null;
  // YouTube URL이면 youtube 노드를, 아니면 일반 북마크로
  const yt = youtubeNodeFromUrl(href);
  if (yt) return yt;
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
  // 로컬 자산(zip/이미지/비디오/파일 등) 으로 resolve 되면 paragraph 내 텍스트가 anchor 와 정확히 일치하지 않아도
  // fileBlock/image 노드로 변환. (Notion 이 zip 같은 첨부를 paragraph 내부의 단일 anchor 로 내보낼 때 텍스트로만 남아버리는 회귀 방지)
  const localAssetNode =
    options?.resolveMediaNode?.(href, anchor) ?? options?.resolveImageNode?.(href, anchor) ?? null;
  if (localAssetNode) return localAssetNode;
  // 로컬 자산이 아니라면 — 외부 URL — paragraph 텍스트가 anchor 텍스트와 정확히 같을 때만 미디어/북마크 변환.
  const paragraphText = (el.textContent ?? "").trim().replace(/\s+/g, " ");
  const anchorText = (anchor.textContent ?? "").trim().replace(/\s+/g, " ");
  if (!paragraphText || paragraphText !== anchorText) return null;
  return null;
}

function blockFingerprint(node: JSONContent): string | null {
  if (node.type === "image") {
    return `image:${String(node.attrs?.src ?? "")}`;
  }
  if (node.type === "bookmarkBlock") {
    return `bookmark:${String(node.attrs?.href ?? "")}:${String(node.attrs?.imageUrl ?? "")}`;
  }
  if (node.type === "paragraph" && Array.isArray(node.content) && node.content.length === 1) {
    const child = node.content[0];
    if (child?.type === "mention") {
      return `mention:${String(child.attrs?.id ?? "")}:${String(child.attrs?.label ?? "")}`;
    }
  }
  return null;
}

function dedupeConsecutiveImportBlocks(input: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = [];
  let prevKey: string | null = null;
  for (const block of input) {
    const key = blockFingerprint(block);
    if (key && key === prevKey) continue;
    out.push(block);
    prevKey = key;
  }
  return out;
}

function notionHtmlToDocInternal(html: string | Document, options?: HtmlToDocOptions): JSONContent {
  const doc = typeof html === "string"
    ? new DOMParser().parseFromString(html, "text/html")
    : html;
  const page = doc.querySelector("article.page") ?? doc.body;
  const blocks: JSONContent[] = [];

  // Notion 의 컬럼 블록은 보통 div.column-list 지만, 일부 export 변형에서 class 가 살짝 다를 수 있어
  // 속성 부분일치 셀렉터로도 잡아낸다. ("column_list", "notion-column-list" 등).
  const elements = Array.from(page.querySelectorAll(
    "details, table, h1, h2, h3, p, ul, ol, aside, figure.callout, figure.bookmark, figure, hr, img, video, blockquote, iframe, pre, div.column-list, div[class*='column-list'], div[class*='column_list']",
  ));
  for (const el of elements) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.closest("header") && el.tagName.toLowerCase() !== "h1") continue;
    if (el.tagName.toLowerCase() !== "figure" && el.closest("figure.callout")) continue;
    if (el.tagName.toLowerCase() !== "figure" && el.closest("figure")) continue;
    // column-list 내부의 자손 블록들은 column-list 처리 단계에서 재귀 변환되므로
    // top-level 순회에서는 건너뛴다. (column-list 자체는 통과)
    {
      const closestColumnList = el.closest("div.column-list, div[class*='column-list'], div[class*='column_list']");
      if (closestColumnList && closestColumnList !== el) continue;
    }

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
    if (
      tag === "div" &&
      (el.classList.contains("column-list") ||
        /column[-_]list/i.test(el.className))
    ) {
      // Notion 의 컬럼 레이아웃: <div class="column-list"><div class="column">...</div>...</div>
      // 퀵노트 columnLayout 스키마는 column{2,4} 이라 컬럼 2~4 개 일 때만 변환,
      // 그 외(1개 또는 5개 이상)는 자식 블록을 평탄화해서 그대로 삽입.
      // 일부 export 는 "column" 대신 다른 클래스를 쓸 수 있어, "column" 매칭 + 클래스 부분일치 + 직속 div 폴백 순으로 탐색.
      let columnEls = Array.from(el.children).filter(
        (c): c is HTMLElement => c instanceof HTMLElement && c.classList.contains("column"),
      );
      if (columnEls.length === 0) {
        columnEls = Array.from(el.children).filter(
          (c): c is HTMLElement => c instanceof HTMLElement && /(^|\s)column(\s|$|-)/i.test(c.className),
        );
      }
      if (columnEls.length === 0) {
        // class 가 다르거나 없는 경우 — 직속 div 자식을 컬럼으로 간주.
        columnEls = Array.from(el.children).filter(
          (c): c is HTMLElement => c instanceof HTMLElement && c.tagName.toLowerCase() === "div",
        );
      }
      const inColumnRange = columnEls.length >= 2 && columnEls.length <= 4;
      const childNodesPerColumn = columnEls.map((columnEl) => {
        // 각 컬럼의 innerHTML 을 한 article.page 로 감싸 재귀 변환 → 내부 블록 JSON 추출.
        const wrapped = `<article class="page">${columnEl.innerHTML}</article>`;
        const innerDoc = notionHtmlToDocInternal(wrapped, options);
        const innerContent = Array.isArray(innerDoc.content) ? (innerDoc.content as JSONContent[]) : [];
        return innerContent.length > 0 ? innerContent : [{ type: "paragraph" }];
      });
      if (inColumnRange) {
        blocks.push({
          type: "columnLayout",
          content: childNodesPerColumn.map((blocksInCol) => ({
            type: "column",
            content: blocksInCol,
          })),
        });
      } else {
        // 컬럼 개수가 스키마를 벗어나면 그대로 펼쳐 본문에 추가.
        for (const colBlocks of childNodesPerColumn) {
          for (const b of colBlocks) blocks.push(b);
        }
      }
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

              // Notion 선택/멀티선택 옵션 — span.selected-value (또는 selected-value-color-*)
              const selectedSpans = Array.from(
                cell.querySelectorAll("span.selected-value, [class*='selected-value']"),
              ).filter((n): n is HTMLElement => n instanceof HTMLElement);
              const selectedOptions = selectedSpans.map((s) => {
                const cls = s.className;
                const token = cls
                  .split(/\s+/)
                  .find((c) => c.startsWith("select-value-color-") || c.startsWith("selected-value-color-") || c.startsWith("status-value-color-"));
                return {
                  label: (s.textContent ?? "").trim(),
                  colorToken: token
                    ? token
                        .replace("select-value-color-", "")
                        .replace("selected-value-color-", "")
                        .replace("status-value-color-", "")
                    : null,
                };
              }).filter((o) => o.label.length > 0);

              // status 색 토큰 (셀 클래스 또는 자식 노드)
              const statusNode = cell.querySelector("[class*='select-value-color-'], [class*='status-value-color-'], [class*='selected-value-color-']");
              const statusClassSource = `${cell.className} ${statusNode?.className ?? ""}`;
              const statusClass = statusClassSource
                .split(/\s+/)
                .find((cls) => cls.startsWith("select-value-color-") || cls.startsWith("status-value-color-") || cls.startsWith("selected-value-color-"));
              const statusColorToken = statusClass
                ? statusClass
                    .replace("select-value-color-", "")
                    .replace("selected-value-color-", "")
                    .replace("status-value-color-", "")
                : (selectedOptions[0]?.colorToken ?? null);

              // 사람 속성 — .user, .notion-user, .person, [class*='-user']
              const personNodes = Array.from(
                cell.querySelectorAll("span.user, .notion-user, .person, [class*='-user']"),
              ).filter((n): n is HTMLElement => n instanceof HTMLElement);
              const personNames = personNodes.map((p) => (p.textContent ?? "").trim()).filter(Boolean);

              return {
                hasTimeTag: !!timeNode,
                statusColorToken,
                statusLike: !!statusClass || selectedOptions.length > 0 || !!cell.querySelector(".property-select, .property-status"),
                selectedCount: selectedOptions.length,
                selectedOptions,
                hasPerson: personNames.length > 0,
                personNames,
              };
            });
            rows.push({ cells: texts, titleLinkPath, cellMeta });
          }
        });
        const databaseId = options.onCollectionTable({ headers, rows });
        if (databaseId) {
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
        }
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
      const mediaBlock = maybeMediaBlockFromParagraph(el, options);
      if (mediaBlock) {
        blocks.push(mediaBlock);
        continue;
      }
      const bookmark = maybeBookmarkBlockFromParagraph(el, options);
      if (bookmark) {
        blocks.push(bookmark);
      } else {
        const paragraphImages = Array.from(el.querySelectorAll("img"))
          .map((img) => imageNodeFromElement(img, options))
          .filter((img): img is JSONContent => !!img);
        if (paragraphImages.length > 0 && (el.textContent ?? "").trim().length === 0) {
          blocks.push(...paragraphImages);
          continue;
        }
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
      // 북마크로 분류되어도 URL이 YouTube면 youtube 노드로 변환
      const yt = youtubeNodeFromElement(el);
      if (yt) {
        blocks.push(yt);
        continue;
      }
      const anchor = el.querySelector("a[href]");
      if (anchor instanceof HTMLElement) {
        const assetNode = assetBlockFromAnchor(anchor, options);
        if (assetNode) {
          blocks.push(assetNode);
          continue;
        }
        const bookmark = bookmarkBlockFromAnchor(anchor, el);
        if (bookmark) {
          blocks.push(bookmark);
          continue;
        }
      }
    }
    if (tag === "iframe") {
      const src = el.getAttribute("src") ?? "";
      const yt = youtubeNodeFromUrl(src);
      if (yt) {
        blocks.push(yt);
        continue;
      }
    }
    if (tag === "blockquote") {
      blocks.push(blockquoteFromElement(el, blockColor, blockToken, options));
      continue;
    }
    if (tag === "pre") {
      blocks.push(codeBlockFromElement(el));
      continue;
    }
    if (tag === "figure") {
      // figure 내부에 youtube 임베드/링크가 있으면 youtube 노드로 변환
      const yt = youtubeNodeFromElement(el);
      if (yt) {
        blocks.push(yt);
        continue;
      }
      const figureAnchor = el.querySelector("a[href]");
      if (figureAnchor instanceof HTMLElement) {
        const mapBookmark = mapBookmarkBlockFromAnchor(figureAnchor, el);
        if (mapBookmark) {
          blocks.push(mapBookmark);
          continue;
        }
      }
      // 북마크 구조(.bookmark-title 등) 가 있으면 이미지 추출보다 우선해서 북마크로 변환.
      // (그렇지 않으면 figureImage 분기가 북마크 썸네일을 단독 이미지로 뽑아내고 링크는 텍스트로 떨어진다.)
      if (hasBookmarkStructure(el) && figureAnchor instanceof HTMLElement) {
        const bookmark = bookmarkBlockFromAnchor(figureAnchor, el);
        if (bookmark) {
          blocks.push(bookmark);
          continue;
        }
      }
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
      // Notion 임베드(외부 링크)는 bookmark 클래스 없이 단순 <figure><a class="source">URL</a></figure> 로 출력됨 → 북마크로 변환
      const embedAnchor = el.querySelector("a[href]");
      if (embedAnchor instanceof HTMLElement) {
        const mediaFromHref = assetBlockFromAnchor(embedAnchor, options);
        if (mediaFromHref) {
          blocks.push(mediaFromHref);
          continue;
        }
        const bookmark = bookmarkBlockFromAnchor(embedAnchor, el);
        if (bookmark) {
          blocks.push(bookmark);
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
      blocks.push(listNodeFromElement(el, blockColor, blockToken, options));
    }
  }

  return {
    type: "doc",
    content:
      blocks.length > 0
        ? dedupeConsecutiveImportBlocks(blocks)
        : [{ type: "paragraph", content: [] }],
  };
}

export function notionHtmlToDoc(html: string | Document, options?: HtmlToDocOptions): JSONContent {
  return notionHtmlToDocInternal(html, options);
}

// Notion HTML 에서 페이지 아이콘 추출
// - emoji: 텍스트 노드 (e.g. "📝")
// - imagePath: 상대 경로 (e.g. "page-name/icon.png") — 호출부에서 자산 리졸버로 처리
export function extractNotionPageIcon(html: string | Document): { emoji?: string; imagePath?: string } | null {
  if (typeof html === "string" && typeof DOMParser === "undefined") return null;
  const doc = typeof html === "string"
    ? new DOMParser().parseFromString(html, "text/html")
    : html;
  const header = doc.querySelector("header") ?? doc.body;
  if (!header) return null;

  // 1) <img class="page-header-icon" src="..."> — 커스텀 업로드 아이콘
  const iconImg = header.querySelector(
    "img.page-header-icon, img.notion-page-icon, img.page-icon",
  );
  if (iconImg instanceof HTMLImageElement) {
    const src = iconImg.getAttribute("src") ?? "";
    if (src && !src.startsWith("data:")) {
      return { imagePath: src };
    }
  }

  // 2) <span class="icon">😀</span> 또는 <div class="page-header-icon">😀</div>
  const iconEl = header.querySelector(
    ".page-header-icon, .notion-page-icon, .page-icon, span.icon, [data-testid='page-icon'], .notion-record-icon",
  );
  if (iconEl instanceof HTMLElement) {
    const text = (iconEl.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text) return { emoji: text };
  }

  // 3) 헤더 텍스트 전체에서 이모지 1개를 추출 (클래스명이 바뀐 Notion export 대응)
  const headerText = (header.textContent ?? "").replace(/\s+/g, " ").trim();
  if (headerText) {
    const emojiMatch = headerText.match(/\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/u);
    if (emojiMatch?.[0]) return { emoji: emojiMatch[0] };
  }
  return null;
}
