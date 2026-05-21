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

export async function fetchBookmarkMetadata(
  rawUrl: string,
  signal: AbortSignal,
): Promise<BookmarkMetadata> {
  const parsed = normalizeBookmarkUrl(rawUrl);
  if (!parsed) return fallbackBookmarkMetadata(rawUrl);
  try {
    return await fetchViaBookmarkApi(parsed.href, signal);
  } catch {
    return fallbackBookmarkMetadata(parsed.href);
  }
}
