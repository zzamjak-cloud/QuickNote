import type { JSONContent } from "@tiptap/react";
import { emptyPanelState } from "../../types/database";
import {
  isLikelyUrlText,
  normalizeImportedLinkHref,
  summarizeImportedLinkText,
} from "./linkUtils";
import { buildQuickNotePageUrl } from "../navigation/quicknoteLinks";
import { MENTION_PAGE_PREFIX } from "../tiptapExtensions/mentionKind";
import {
  HIGHLIGHT_BG_COLOR_MAP,
  parseColorFromStyle,
  parseColorFromClass,
  parseBlockBgFromClass,
} from "./htmlToDoc/colors";
import {
  createDeferredMentionToken,
  pageMentionParagraphFromAnchor,
} from "./htmlToDoc/pageMentions";
import type { HtmlToDocOptions, NotionCollectionTable } from "./htmlToDoc/types";
import { textNode, mergeMarks } from "./htmlToDoc/nodes";
import { textNodesWithAutoLinks } from "./htmlToDoc/inlineText";
import {
  imageNodeFromElement,
  mediaNodeFromElement,
  maybeMediaBlockFromParagraph,
} from "./htmlToDoc/media";
import {
  youtubeNodeFromUrl,
  youtubeNodeFromElement,
} from "./htmlToDoc/youtube";
import {
  hasBookmarkStructure,
  bookmarkBlockFromAnchor,
  isMapLinkHref,
  hasDuplicateMapBookmarkAnchor,
  mapBookmarkBlockFromAnchor,
  maybeBookmarkBlockFromParagraph,
} from "./htmlToDoc/bookmark";
import { codeBlockFromElement } from "./htmlToDoc/code";
import { normalizeHeadingTitle, buildHeadingTitleIndex } from "./htmlToDoc/headingIndex";
import { dedupeConsecutiveImportBlocks } from "./htmlToDoc/dedupe";
import {
  assetBlockFromAnchor,
  linkToPageFallbackParagraph,
  resolveRelativePath,
  relocateDeferredMentionsInToggleBlocks,
} from "./htmlToDoc/anchors";

export type { NotionCollectionTable } from "./htmlToDoc/types";

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
  // Notion 체크박스(to-do) 리스트 — <ul class="to-do-list"> → 퀵노트 taskList/taskItem.
  const isTaskList =
    tag === "ul" &&
    (el.classList.contains("to-do-list") || el.classList.contains("to_do_list"));
  const items: JSONContent[] = [];
  const liNodes = Array.from(el.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.tagName.toLowerCase() === "li",
  );

  for (const li of liNodes) {
    const paragraphInlines: JSONContent[] = [];
    const nestedBlocks: JSONContent[] = [];

    // li 의 "직접" 중첩 리스트만 — details/figure/callout 등 블록 자식 내부의 ul/ol 은
    // 그 블록이 별도 추출되어 자체 변환되므로 제외한다. (li > details > ul 의 ul 을
    // li 의 중첩 리스트로도, 추출된 details 내부로도 이중 렌더해 이미지/토글이 중복되던 회귀 방지)
    const nestedLists = Array.from(li.querySelectorAll("ul, ol")).filter(
      (list) =>
        list instanceof HTMLElement &&
        list.closest(`li, ${LI_BLOCK_CHILD_SELECTOR}`) === li,
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

    // to-do 항목의 체크 상태 — checkbox-on 클래스 또는 checked input.
    const checked =
      isTaskList &&
      (li.querySelector(".checkbox-on, .checkbox_on, .checkbox-checked") != null ||
        li.querySelector("input[type='checkbox']:checked") != null ||
        li.querySelector("input[type='checkbox'][checked]") != null ||
        li.querySelector(".to-do-children-checked") != null ||
        /to-do-children-checked|checkbox-on/.test(li.className));

    const liClone = li.cloneNode(true) as HTMLElement;
    for (const nested of Array.from(liClone.querySelectorAll("ul, ol"))) {
      nested.remove();
    }
    // 체크박스 마커(div.checkbox / input)는 텍스트로 평탄화되지 않도록 제거.
    for (const cb of Array.from(
      liClone.querySelectorAll(".checkbox, input[type='checkbox']"),
    )) {
      cb.remove();
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
    if (isTaskList) {
      items.push({
        type: "taskItem",
        attrs: liBgToken ? { checked: !!checked, backgroundColor: liBgToken } : { checked: !!checked },
        content: listItemContent,
      });
    } else {
      items.push({
        type: "listItem",
        attrs: liBgToken ? { backgroundColor: liBgToken } : undefined,
        content: listItemContent,
      });
    }
  }

  // Notion 은 번호 목록의 각 항목을 별도의 <ol start="N"> 으로 내보내는 경우가 많다.
  // start 속성을 그대로 사용해야 1, 2, 3 ... 으로 정확히 표시된다.
  // (start 를 항상 1 로 고정하면 모든 항목이 "1." 로만 표시되는 회귀가 발생한다)
  const startRaw = isOrdered ? el.getAttribute("start") : null;
  const startNum = startRaw && /^\d+$/.test(startRaw) ? Math.max(1, parseInt(startRaw, 10)) : 1;
  if (isTaskList) {
    return {
      type: "taskList",
      attrs: blockToken ? { blockTextColor: blockToken } : undefined,
      content: items,
    };
  }
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

// div/section 등 래퍼가 블록 요소 없이 인라인 콘텐츠(텍스트·strong·code·br 등)만 담는지 판별.
// true 면 자식을 개별 순회해 쪼개지 말고 한 문단으로(br→hardBreak) 변환해야 줄바꿈이 보존된다.
// (노션 콜아웃 본문 div 가 대표적: <div>...<br/>...<br/>...</div>)
const BLOCK_LEVEL_TAGS_IN_CONTAINER = new Set([
  "p", "div", "section", "article", "details", "summary", "table", "thead", "tbody", "tr",
  "aside", "figure", "ul", "ol", "li", "blockquote", "pre", "iframe", "img", "video", "source",
  "hr", "h1", "h2", "h3", "h4", "h5", "h6",
]);
function isInlineOnlyWrapper(el: HTMLElement): boolean {
  for (const child of Array.from(el.children)) {
    if (child instanceof HTMLElement && BLOCK_LEVEL_TAGS_IN_CONTAINER.has(child.tagName.toLowerCase())) {
      return false;
    }
  }
  return true;
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
        out.push(calloutFromAside(node, options));
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
        // 멘션 해소 실패 시에도 아이콘 img 를 본문 이미지로 추출하지 않는다(제목만 보존).
        if (anchor instanceof HTMLElement) {
          const fallback = linkToPageFallbackParagraph(anchor);
          if (fallback) out.push(fallback);
        }
        return;
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
      // 토글/콜아웃 등 컨테이너 내부의 컬럼 레이아웃 — div 평탄화보다 먼저 처리해야
      // columnLayout 구조가 보존된다. (이전에는 div 브랜치에서 컬럼이 평탄화돼 사라짐)
      if (isColumnListElement(node)) {
        out.push(...columnLayoutBlocksFromColumnList(node, options));
        return;
      }
      if (tag === "div" || tag === "section" || tag === "article") {
        // 블록 자식 없이 인라인(텍스트/strong/code/br 등)만 담은 래퍼는 한 문단으로 변환해
        // 내부 <br> 줄바꿈을 hardBreak 로 보존한다(노션 콜아웃 본문 div 가 이 형태).
        // 자식별로 쪼개 순회하면 strong/br 이 각자 별도 문단이 되며 줄바꿈이 유실된다.
        if (isInlineOnlyWrapper(node) && (node.textContent ?? "").trim().length > 0) {
          out.push(paragraphFromElement(node, blockColor, blockToken, options));
          return;
        }
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
  // 노션 export 의 heading id(uuid) 를 보존한다. UniqueID 확장이 attrs.id 를 런타임까지
  // 유지하므로, 자기참조 링크의 blockId 와 이 heading 의 attrs.id 가 정확히 일치한다.
  // id 가 없으면 UniqueID 가 런타임에 부여하도록 그대로 둔다.
  const hid = (el.getAttribute("id") ?? "").trim();
  if (hid) attrs.id = hid;
  return {
    type: "heading",
    attrs,
    content: content.length > 0 ? content : [],
  };
}

// 콜아웃 본문 컨테이너를 블록 리스트로 변환한다.
// 컨테이너가 블록 자식 없이 인라인(텍스트/strong/code/br 등)만 담으면 자식별로 쪼개지 말고
// 한 문단으로(br→hardBreak) 변환해 줄바꿈을 보존한다(노션 콜아웃 본문 div 가 이 형태).
function calloutBodyBlocks(
  container: HTMLElement,
  blockColor: string | null,
  blockToken: string | null,
  options?: HtmlToDocOptions,
): JSONContent[] {
  if (isInlineOnlyWrapper(container) && (container.textContent ?? "").trim().length > 0) {
    return [paragraphFromElement(container, blockColor, blockToken, options)];
  }
  return blocksFromContainerChildren(container, blockColor, blockToken, options);
}

function calloutFromAside(aside: HTMLElement, options?: HtmlToDocOptions): JSONContent {
  const classColor = parseColorFromClass(aside.className);
  const blockColor = parseColorFromStyle(aside.getAttribute("style")) ?? classColor?.css ?? null;
  const blockToken = classColor?.token ?? null;
  // options 를 반드시 본문 변환에 전달해야 한다 — 누락 시 aside 콜아웃 내부 이미지/미디어/
  // 페이지멘션이 리졸버 없이 변환돼 원본 노션 상대경로로 남고(업로드된 자산과 미연결) 404 가 된다.
  const blocks = calloutBodyBlocks(aside, blockColor, blockToken, options);
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
  const blocks = calloutBodyBlocks(textContainer, blockColor, blockToken, options);
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

// Notion 컬럼 레이아웃(div.column-list > div.column …) → 퀵노트 columnLayout 변환.
// 퀵노트 스키마는 column{2,6} 라 2~6 개일 때만 columnLayout, 그 외엔 자식 블록 평탄화.
// top-level 순회와 토글/콜아웃 등 컨테이너 내부(blocksFromContainerChildren) 양쪽에서 재사용한다.
function columnLayoutBlocksFromColumnList(
  el: HTMLElement,
  options?: HtmlToDocOptions,
): JSONContent[] {
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
  const inColumnRange = columnEls.length >= 2 && columnEls.length <= 6;
  const childNodesPerColumn = columnEls.map((columnEl) => {
    // 각 컬럼의 innerHTML 을 한 article.page 로 감싸 재귀 변환 → 내부 블록 JSON 추출.
    const wrapped = `<article class="page">${columnEl.innerHTML}</article>`;
    const innerDoc = notionHtmlToDocInternal(wrapped, options);
    const innerContent = Array.isArray(innerDoc.content) ? (innerDoc.content as JSONContent[]) : [];
    return innerContent.length > 0 ? innerContent : [{ type: "paragraph" }];
  });
  if (inColumnRange) {
    return [{
      type: "columnLayout",
      content: childNodesPerColumn.map((blocksInCol) => ({
        type: "column",
        content: blocksInCol,
      })),
    }];
  }
  // 컬럼 개수가 스키마를 벗어나면 그대로 펼친다.
  return childNodesPerColumn.flat();
}

function isColumnListElement(node: HTMLElement): boolean {
  return (
    node.tagName.toLowerCase() === "div" &&
    (node.classList.contains("column-list") || /column[-_]list/i.test(node.className))
  );
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
      // 자기참조(=같은 페이지로 해소되는) 링크: 페이지 멘션으로 만들면 라벨 대신 페이지 제목이
      // reactive 표시되어 모든 용어 링크가 제목으로 보인다. 라벨(용어명) 텍스트를 보존하고,
      // 클릭 시 같은 페이지 안에서 그 용어명과 일치하는 블록으로 점프하는 내부 링크로 변환한다.
      if (pageMention.intraPage) {
        // 자기참조 링크: 라벨↔제목 정확·유일 매칭으로 blockId 를 복원한다.
        // 매칭되면 안정적 blockId 링크(편집에도 안전), 아니면 가짜 연결을 피해 라벨만 보존한다.
        const intraLabel = labelText || pageMention.label || "";
        const blockId = options?.resolveIntraPageBlockId?.(intraLabel) ?? null;
        if (blockId) {
          return [textNode(intraLabel, [{
            type: "link",
            attrs: {
              href: buildQuickNotePageUrl({ pageId: pageMention.pageId, blockId }),
              target: "_blank",
              rel: "noopener noreferrer",
            },
          }])];
        }
        return [textNode(intraLabel)];
      }
      if (options?.deferPageMentions) {
        return [textNode(createDeferredMentionToken(pageMention.pageId, pageMention.label ?? labelText ?? "페이지"))];
      }
      return [{
        type: "mention",
        attrs: {
          id: `${MENTION_PAGE_PREFIX}${pageMention.pageId}`,
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

function notionHtmlToDocInternal(html: string | Document, options?: HtmlToDocOptions): JSONContent {
  const doc = typeof html === "string"
    ? new DOMParser().parseFromString(html, "text/html")
    : html;
  const page = doc.querySelector("article.page") ?? doc.body;
  const blocks: JSONContent[] = [];

  // 자기참조 링크 해소용 제목 색인을 페이지 단위로 구성한다.
  // 호출부가 resolveIntraPageBlockId 를 이미 주입했으면 그대로 쓰고(중첩 변환 등),
  // 아니면 이 페이지의 heading 색인으로 resolver 를 만들어 options 에 합친다.
  let effectiveOptions = options;
  if (page && !options?.resolveIntraPageBlockId) {
    const headingIndex = buildHeadingTitleIndex(page);
    if (headingIndex.size > 0) {
      effectiveOptions = {
        ...options,
        resolveIntraPageBlockId: (label: string) => {
          const hit = headingIndex.get(normalizeHeadingTitle(label));
          return hit && hit.count === 1 ? hit.id : null;
        },
      };
    }
  }
  options = effectiveOptions;

  // Notion 의 컬럼 블록은 보통 div.column-list 지만, 일부 export 변형에서 class 가 살짝 다를 수 있어
  // 속성 부분일치 셀렉터로도 잡아낸다. ("column_list", "notion-column-list" 등).
  const elements = Array.from(page.querySelectorAll(
    "details, table, h1, h2, h3, p, ul, ol, aside, figure.callout, figure.bookmark, figure, hr, img, video, blockquote, iframe, pre, div.column-list, div[class*='column-list'], div[class*='column_list']",
  ));
  for (const el of elements) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.closest("header") && el.tagName.toLowerCase() !== "h1") continue;
    // 콜아웃(figure.callout / aside) 내부의 모든 자손 블록(이미지·figure·문단 등)은
    // 콜아웃 변환(calloutFromFigure/calloutFromAside→blocksFromContainerChildren)에서
    // 재귀 처리된다. top-level 에서 또 처리하면 콜아웃 안의 이미지가 안/밖으로 중복되므로
    // 콜아웃 컨테이너 자신을 제외한 자손은 건너뛴다.
    {
      const calloutAncestor = el.closest("figure.callout, aside");
      if (calloutAncestor && calloutAncestor !== el) continue;
    }
    if (el.tagName.toLowerCase() !== "figure" && el.closest("figure")) continue;
    // column-list 내부의 자손 블록들은 column-list 처리 단계에서 재귀 변환되므로
    // top-level 순회에서는 건너뛴다. (column-list 자체는 통과)
    {
      const closestColumnList = el.closest("div.column-list, div[class*='column-list'], div[class*='column_list']");
      if (closestColumnList && closestColumnList !== el) continue;
    }
    // li 내부의 모든 자손 블록(문단·이미지·미디어·토글·콜아웃·중첩 리스트 등)은
    // 리스트 변환(listNodeFromElement)이 재귀로 렌더한다. top-level 에서 또 처리하면
    // 리스트 안/밖으로 중복(중첩 토글·이미지의 다중 복제 회귀)되므로 li 자손 전체를 건너뛴다.
    // (top-level 리스트 컨테이너 ul/ol 자신은 li 밖이라 통과)
    if (el.closest("li")) continue;

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
    if (tag === "details") {
      blocks.push(toggleFromDetails(el, options, blockColor, blockToken));
      continue;
    }
    if (isColumnListElement(el)) {
      blocks.push(...columnLayoutBlocksFromColumnList(el, options));
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
      blocks.push(calloutFromAside(el, options));
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
      // 멘션 해소 실패 시에도 link-to-page 는 generic figure 분기로 넘어가 아이콘 img 를
      // 본문 이미지로 추출해서는 안 된다(이미지+멘션 중복처럼 보이던 회귀). 제목만 보존하고 종료.
      if (anchor instanceof HTMLElement) {
        const fallback = linkToPageFallbackParagraph(anchor);
        if (fallback) blocks.push(fallback);
      }
      continue;
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
  const realHeader = doc.querySelector("header");
  const header = realHeader ?? doc.body;
  if (!header) return null;

  // 1) 커스텀 업로드 아이콘 이미지.
  // Notion export 는 <img class="page-header-icon"> 처럼 img 에 직접 클래스를 주기도 하고,
  // <span class="page-header-icon"><img/></span> 처럼 컨테이너로 감싸기도 한다. 둘 다 잡는다.
  const iconImg = header.querySelector(
    "img.page-header-icon, img.notion-page-icon, img.page-icon, " +
    ".page-header-icon img, .notion-page-icon img, .page-icon img, " +
    "[data-testid='page-icon'] img, .notion-record-icon img",
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

  // 4) 클래스명이 export 변형으로 달라진 경우의 최종 폴백.
  // 실제 <header> 가 있을 때만, 커버를 제외한 첫 <img> 를 아이콘 이미지로 간주한다.
  // (body 폴백 상태에서는 본문 이미지를 아이콘으로 오인할 수 있어 적용하지 않는다.)
  if (!realHeader) return null;
  const fallbackImg = Array.from(realHeader.querySelectorAll("img")).find((img) => {
    if (!(img instanceof HTMLImageElement)) return false;
    if (/cover/i.test(img.className ?? "")) return false;
    const src = img.getAttribute("src") ?? "";
    return !!src && !src.startsWith("data:");
  });
  if (fallbackImg instanceof HTMLImageElement) {
    return { imagePath: fallbackImg.getAttribute("src") ?? "" };
  }
  return null;
}
