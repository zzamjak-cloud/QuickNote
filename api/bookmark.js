const PRIVATE_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase();
  if (PRIVATE_HOSTS.has(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function metaContent(html, attr, value) {
  const pattern = new RegExp(
    `<meta\\s+[^>]*${attr}=["']${escapeRegExp(value)}["'][^>]*>`,
    "i",
  );
  const tag = html.match(pattern)?.[0] ?? "";
  return (
    tag.match(/\scontent=["']([^"']*)["']/i)?.[1]?.trim() ??
    tag.match(/\scontent=([^>\s]+)/i)?.[1]?.trim() ??
    ""
  );
}

function titleContent(html) {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function absolutizeUrl(value, baseUrl) {
  if (!value) return "";
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return "";
  }
}

function metadataFromHtml(html, url) {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./, "");
  const title =
    metaContent(html, "property", "og:title") ||
    metaContent(html, "name", "twitter:title") ||
    titleContent(html) ||
    host;
  const description =
    metaContent(html, "property", "og:description") ||
    metaContent(html, "name", "twitter:description") ||
    metaContent(html, "name", "description") ||
    url;
  const siteName = metaContent(html, "property", "og:site_name") || host;
  const imageUrl = absolutizeUrl(
    metaContent(html, "property", "og:image") ||
      metaContent(html, "name", "twitter:image"),
    url,
  );
  return {
    url,
    title: decodeEntities(title),
    description: decodeEntities(description),
    siteName: decodeEntities(siteName),
    imageUrl,
  };
}

export default async function handler(request, response) {
  try {
    const rawUrl = request.query?.url;
    if (typeof rawUrl !== "string") {
      response.status(400).json({ error: "url is required" });
      return;
    }
    const url = new URL(rawUrl);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || isPrivateHost(url.hostname)) {
      response.status(400).json({ error: "unsupported url" });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const upstream = await fetch(url.href, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; QuickNoteBookmarkBot/1.0; +https://quicknote.app)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timer);

    if (!upstream.ok) {
      response.status(upstream.status).json({ error: "fetch failed" });
      return;
    }
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) {
      response.status(415).json({ error: "not html" });
      return;
    }
    const html = (await upstream.text()).slice(0, 1_000_000);
    response
      .setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800")
      .status(200)
      .json(metadataFromHtml(html, url.href));
  } catch {
    response.status(500).json({ error: "bookmark metadata failed" });
  }
}
