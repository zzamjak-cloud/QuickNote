export type BookmarkMetadata = {
  url: string;
  title: string;
  description: string;
  siteName: string;
  imageUrl: string;
};

function normalizeBookmarkUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

export function fallbackBookmarkMetadata(rawUrl: string): BookmarkMetadata {
  const parsed = normalizeBookmarkUrl(rawUrl);
  const host = parsed?.hostname.replace(/^www\./, "") ?? "웹 페이지";
  return {
    url: parsed?.href ?? rawUrl,
    title: host,
    description: parsed?.href ?? rawUrl,
    siteName: host,
    imageUrl: "",
  };
}

function metaContent(doc: Document, selector: string): string {
  const el = doc.querySelector<HTMLMetaElement>(selector);
  return el?.content?.trim() ?? "";
}

function absolutizeUrl(value: string, baseUrl: string): string {
  if (!value) return "";
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return "";
  }
}

function parseHtmlMetadata(html: string, url: string): BookmarkMetadata {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const fallback = fallbackBookmarkMetadata(url);
  const title =
    metaContent(doc, 'meta[property="og:title"]') ||
    metaContent(doc, 'meta[name="twitter:title"]') ||
    doc.querySelector("title")?.textContent?.trim() ||
    fallback.title;
  const description =
    metaContent(doc, 'meta[property="og:description"]') ||
    metaContent(doc, 'meta[name="twitter:description"]') ||
    metaContent(doc, 'meta[name="description"]') ||
    fallback.description;
  const siteName =
    metaContent(doc, 'meta[property="og:site_name"]') || fallback.siteName;
  const imageUrl = absolutizeUrl(
    metaContent(doc, 'meta[property="og:image"]') ||
      metaContent(doc, 'meta[name="twitter:image"]'),
    url,
  );
  return {
    url: fallback.url,
    title,
    description,
    siteName,
    imageUrl,
  };
}

async function fetchViaBookmarkApi(url: string, signal: AbortSignal) {
  const response = await fetch(`/api/bookmark?url=${encodeURIComponent(url)}`, {
    signal,
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`bookmark api failed: ${response.status}`);
  const data = (await response.json()) as Partial<BookmarkMetadata>;
  const fallback = fallbackBookmarkMetadata(url);
  return {
    url: data.url || fallback.url,
    title: data.title || fallback.title,
    description: data.description || fallback.description,
    siteName: data.siteName || fallback.siteName,
    imageUrl: data.imageUrl || "",
  };
}

async function fetchDirect(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal, credentials: "omit" });
  if (!response.ok) throw new Error(`bookmark fetch failed: ${response.status}`);
  const html = await response.text();
  return parseHtmlMetadata(html, url);
}

export async function fetchBookmarkMetadata(
  rawUrl: string,
  signal: AbortSignal,
): Promise<BookmarkMetadata> {
  const parsed = normalizeBookmarkUrl(rawUrl);
  if (!parsed) return fallbackBookmarkMetadata(rawUrl);
  try {
    return await fetchViaBookmarkApi(parsed.href, signal);
  } catch {
    try {
      return await fetchDirect(parsed.href, signal);
    } catch {
      return fallbackBookmarkMetadata(parsed.href);
    }
  }
}
