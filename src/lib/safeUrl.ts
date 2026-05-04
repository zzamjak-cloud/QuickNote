/** XSS(CWE-79) 및 오픈 리다이렉트 완화용 — 사용자 입력·붙여넣기 링크 검사 */

const DANGEROUS_HREF = /^\s*(javascript:|data:|vbscript:)/i;

function stripDangerousProtocols(href: string): boolean {
  return !DANGEROUS_HREF.test(href);
}

/**
 * 버블 툴바 등에서 링크로 삽입할 수 있는 http(s)/mailto/tel만 허용.
 * 상대 경로·내부 앵커는 거부(프롬프트 입력만 사용하는 경로 기준).
 */
export function sanitizeWebLinkHref(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (!stripDangerousProtocols(t)) return null;
  if (t.startsWith("mailto:")) {
    try {
      const u = new URL(t);
      return u.protocol === "mailto:" ? t : null;
    } catch {
      return null;
    }
  }
  if (t.startsWith("tel:")) {
    try {
      const u = new URL(t);
      return u.protocol === "tel:" ? t : null;
    } catch {
      return null;
    }
  }
  let candidate = t;
  if (!/^https?:\/\//i.test(candidate)) {
    if (/^[\w][\w.-]*\.[a-zA-Z]{2,}/.test(candidate)) {
      candidate = `https://${candidate}`;
    } else {
      return null;
    }
  }
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!stripDangerousProtocols(u.href)) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** TipTap Link `isAllowedUri` — dangerous 스킴 명시 차단 후 기본 검증 위임 */
export function isAllowedTipTapLinkUri(
  url: string,
  ctx: {
    defaultValidate: (u: string) => boolean;
    protocols: unknown;
    defaultProtocol: string;
  },
): boolean {
  if (!stripDangerousProtocols(url)) return false;
  return ctx.defaultValidate(url);
}

const YT_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

function normalizeHost(hostname: string): string {
  let h = hostname.toLowerCase();
  if (h.startsWith("www.")) h = h.slice(4);
  return h;
}

function parseLooseHttpUrl(raw: string): URL | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    return new URL(t);
  } catch {
    try {
      return new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    } catch {
      return null;
    }
  }
}

/** 슬래시 메뉴·임베드용 — YouTube·youtu.be 호스트만 허용 */
export function isTrustedYoutubeInput(raw: string): boolean {
  const u = parseLooseHttpUrl(raw);
  if (!u) return false;
  const host = normalizeHost(u.hostname);
  return YT_HOSTS.has(host);
}
