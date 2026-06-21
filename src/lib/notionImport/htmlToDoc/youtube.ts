import type { JSONContent } from "@tiptap/react";

// YouTube URL → videoId 추출 (watch?v=, youtu.be/, embed/, shorts/, live/ 모두 지원)
export function extractYoutubeVideoId(url: string): string | null {
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

export function youtubeNodeFromUrl(url: string): JSONContent | null {
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
export function youtubeNodeFromElement(el: HTMLElement): JSONContent | null {
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
