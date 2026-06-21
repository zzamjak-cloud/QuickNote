import type { JSONContent } from "@tiptap/react";
import { normalizeImportedLinkHref } from "../linkUtils";
import type { HtmlToDocOptions } from "./types";
import { youtubeNodeFromUrl } from "./youtube";

/**
 * Notion 의 figure 가 북마크 구조(.bookmark-title / .bookmark-description / .bookmark-href / .bookmark-image)
 * 를 포함하는지 검사. class="bookmark" 가 없는 경우에도 이 구조면 북마크로 우선 변환해야
 * 내부 이미지가 단독 image 블록으로 추출되어 버리는 회귀를 막을 수 있다.
 */
export function hasBookmarkStructure(figure: HTMLElement): boolean {
  if (figure.classList.contains("bookmark")) return true;
  return !!figure.querySelector(".bookmark-title, .bookmark-description, .bookmark-href, .bookmark-info");
}

export function bookmarkBlockFromAnchor(anchor: HTMLElement, container?: HTMLElement | null): JSONContent | null {
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

export function isMapLinkHref(href: string): boolean {
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

export function hasDuplicateMapBookmarkAnchor(anchor: HTMLElement): boolean {
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

export function mapBookmarkBlockFromAnchor(anchor: HTMLElement, container?: HTMLElement | null): JSONContent | null {
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
    .replace(/[•·\-–—>→]+/g, " ")
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

export function maybeBookmarkBlockFromParagraph(el: HTMLElement, options?: HtmlToDocOptions): JSONContent | null {
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
