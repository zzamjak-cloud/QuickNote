import type { JSONContent } from "@tiptap/react";
import type { HtmlToDocOptions } from "./types";
import { figcaptionTextForImage, withCaption } from "./nodes";

export function imageNodeFromElement(
  img: HTMLElement,
  options?: HtmlToDocOptions,
): JSONContent | null {
  const rawSrc = img.getAttribute("src") ?? "";
  if (!rawSrc) return null;
  const caption = figcaptionTextForImage(img);
  const custom = options?.resolveMediaNode?.(rawSrc, img) ?? options?.resolveImageNode?.(rawSrc, img);
  if (custom) return withCaption(custom, caption);
  const resolved = options?.resolveImageSrc?.(rawSrc) ?? rawSrc;
  if (!resolved) return null;
  return {
    type: "image",
    attrs: {
      src: resolved,
      alt: img.getAttribute("alt") ?? "",
      ...(caption ? { caption } : {}),
    },
  };
}

export function mediaNodeFromElement(
  el: HTMLElement,
  options?: HtmlToDocOptions,
): JSONContent | null {
  const rawSrc = el.getAttribute("src") ?? el.querySelector("source[src]")?.getAttribute("src") ?? "";
  if (!rawSrc) return null;
  return options?.resolveMediaNode?.(rawSrc, el) ?? options?.resolveImageNode?.(rawSrc, el) ?? null;
}

export function maybeMediaBlockFromParagraph(el: HTMLElement, options?: HtmlToDocOptions): JSONContent | null {
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
