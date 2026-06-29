import dns from "node:dns/promises";
import net from "node:net";

// 정수/16진수/8진수 IPv4 표기(예: 2130706433, 0x7f000001, 0177.0.0.1)를 점표기로 정규화한다.
// 이런 우회 표기를 그대로 두면 사설대역 정규식·문자열 비교를 통과해 SSRF 로 악용된다.
function normalizeIpv4(host) {
  if (net.isIP(host) === 4) return host;
  // 단일 정수: 0xHEX, 0OCTAL, DECIMAL
  if (/^(0x[0-9a-f]+|0[0-7]*|\d+)$/i.test(host)) {
    let n;
    try {
      n = host.toLowerCase().startsWith("0x")
        ? parseInt(host, 16)
        : /^0[0-7]+$/.test(host)
          ? parseInt(host, 8)
          : parseInt(host, 10);
    } catch {
      return host;
    }
    if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return host;
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  }
  return host;
}

// IP(IPv4/IPv6) 가 사설·루프백·링크로컬·메타데이터·예약 대역에 속하는지 판정한다.
function isBlockedIp(ip) {
  const fam = net.isIP(ip);
  if (fam === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true; // 0.0.0.0/8, 10/8, 루프백
    if (a === 169 && b === 254) return true; // 링크로컬 + 클라우드 메타데이터(169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    if (a >= 224) return true; // 멀티캐스트/예약(224+ , 240+)
    return false;
  }
  if (fam === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true; // 루프백/미지정
    // IPv4-mapped (::ffff:x.x.x.x) 는 내부 IPv4 로 재판정
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    if (/^f[cd]/.test(v)) return true; // ULA fc00::/7
    if (/^fe[89ab]/.test(v)) return true; // 링크로컬 fe80::/10
    return false;
  }
  return true; // IP 형식이 아니면 안전측으로 차단
}

// 호스트명을 DNS 로 해석해 모든 결과 IP 가 공인 대역인지 검증한다(rebinding 1차 방어).
// 어떤 레코드라도 차단 대역이면 거부한다.
async function assertPublicHost(hostname) {
  const normalized = normalizeIpv4(hostname);
  if (net.isIP(normalized)) {
    if (isBlockedIp(normalized)) throw new Error("blocked host");
    return;
  }
  const records = await dns.lookup(hostname, { all: true });
  if (records.length === 0) throw new Error("dns resolve failed");
  for (const { address } of records) {
    if (isBlockedIp(address)) throw new Error("blocked host");
  }
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

function isGoogleMapsUrl(url) {
  const host = url.hostname.toLowerCase();
  return host.includes("google.") && (url.pathname.startsWith("/maps") || host === "maps.app.goo.gl");
}

function isNaverMapUrl(url) {
  const host = url.hostname.toLowerCase();
  return host === "map.naver.com" || host.endsWith(".map.naver.com");
}

function stripHtmlTags(value) {
  return String(value || "").replace(/<[^>]+>/g, "").trim();
}

function parseMapLabel(url) {
  const raw =
    url.searchParams.get("query")
    || url.searchParams.get("q")
    || url.searchParams.get("title")
    || "";
  if (!raw) return "";
  try {
    return decodeURIComponent(raw).replace(/\+/g, " ").trim();
  } catch {
    return raw.trim();
  }
}

async function fetchGoogleMapMetadata(url) {
  const label = parseMapLabel(url);
  const title = label || "Google 지도";
  return {
    url: url.href,
    title,
    description: label || url.href,
    siteName: "Google 지도",
    imageUrl: "",
  };
}

async function fetchNaverMapMetadata(url) {
  const label = stripHtmlTags(parseMapLabel(url));
  const title = label || "네이버 지도";

  return {
    url: url.href,
    title,
    description: label || url.href,
    siteName: "네이버 지도",
    imageUrl: "",
  };
}

async function fetchMapMetadata(url) {
  if (isGoogleMapsUrl(url)) return fetchGoogleMapMetadata(url);
  if (isNaverMapUrl(url)) return fetchNaverMapMetadata(url);
  return null;
}

const MAX_BODY_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;

// 리다이렉트를 직접 따라가며 매 홉마다 프로토콜·호스트를 재검증한다.
// fetch 의 자동 리다이렉트는 허용 호스트가 내부망(169.254.169.254 등)으로 보내는 302 를
// 그대로 따라가 초기 검증을 무력화하므로 redirect:"manual" 로 통제한다.
async function safeFetch(initialUrl, signal) {
  let url = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    await assertPublicHost(url.hostname);
    const res = await fetch(url.href, {
      signal,
      redirect: "manual",
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; QuickNoteBookmarkBot/1.0; +https://quicknote.app)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      url = new URL(location, url.href);
      continue;
    }
    return res;
  }
  throw new Error("too many redirects");
}

// 응답 본문을 스트리밍으로 읽되 누적 바이트가 한계를 넘으면 즉시 중단한다.
// (await upstream.text() 는 수 GB 응답도 끝까지 메모리에 적재해 함수가 고갈된다.)
async function readCappedText(res) {
  const lengthHeader = Number(res.headers.get("content-length"));
  if (Number.isFinite(lengthHeader) && lengthHeader > MAX_BODY_BYTES) {
    throw new Error("body too large");
  }
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  return chunks.join("");
}

export default async function handler(request, response) {
  try {
    const rawUrl = request.query?.url;
    if (typeof rawUrl !== "string") {
      response.status(400).json({ error: "url is required" });
      return;
    }
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      response.status(400).json({ error: "unsupported url" });
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      response.status(400).json({ error: "unsupported url" });
      return;
    }

    const mapMeta = await fetchMapMetadata(url);
    if (mapMeta) {
      response
        .setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800")
        .status(200)
        .json(mapMeta);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let upstream;
    try {
      upstream = await safeFetch(url, controller.signal);
    } finally {
      clearTimeout(timer);
    }

    if (!upstream.ok) {
      response.status(502).json({ error: "fetch failed" });
      return;
    }
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) {
      response.status(415).json({ error: "not html" });
      return;
    }
    const html = (await readCappedText(upstream)).slice(0, MAX_BODY_BYTES);
    response
      .setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800")
      .status(200)
      .json(metadataFromHtml(html, url.href));
  } catch {
    response.status(500).json({ error: "bookmark metadata failed" });
  }
}
