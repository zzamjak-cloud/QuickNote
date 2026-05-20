import { sanitizeWebLinkHref } from "../safeUrl";

const REDIRECT_QUERY_KEYS = ["url", "u", "target", "q"];

export function normalizeImportedLinkHref(rawHref: string): string | null {
  const trimmed = rawHref.trim();
  if (!trimmed) return null;

  const direct = sanitizeWebLinkHref(trimmed);
  if (direct) return direct;

  if (/^www\./i.test(trimmed)) {
    const prefixed = sanitizeWebLinkHref(`https://${trimmed}`);
    if (prefixed) return prefixed;
  }

  try {
    const decoded = decodeURIComponent(trimmed);
    const decodedSafe = sanitizeWebLinkHref(decoded);
    if (decodedSafe) return decodedSafe;
  } catch {
    // 디코드 실패는 무시하고 다음 케이스를 검사한다.
  }

  const withBase = trimmed.startsWith("/")
    ? `https://www.notion.so${trimmed}`
    : trimmed;
  try {
    const parsed = new URL(withBase);
    for (const key of REDIRECT_QUERY_KEYS) {
      const value = parsed.searchParams.get(key);
      if (!value) continue;
      const safe = sanitizeWebLinkHref(value) ?? sanitizeWebLinkHref(decodeURIComponent(value));
      if (safe) return safe;
    }
  } catch {
    // URL 파싱 실패는 링크 미지원으로 처리한다.
  }

  return null;
}

export function isLikelyUrlText(raw: string): boolean {
  const t = raw.trim();
  return /^https?:\/\//i.test(t) || /^www\./i.test(t);
}

export function summarizeImportedLinkText(rawHref: string): string {
  const safe = normalizeImportedLinkHref(rawHref);
  if (!safe) return rawHref;
  try {
    const u = new URL(safe);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    if (host.includes("drive.google.com") || host.includes("docs.google.com")) {
      return "🔗 Google Drive";
    }
    if (host.includes("flex.team")) {
      return "🔗 flex.team";
    }
    if (!path || path === "/") {
      return `🔗 ${host}`;
    }
    const parts = path.split("/").filter(Boolean).slice(0, 2);
    return `🔗 ${host}/${parts.join("/")}`;
  } catch {
    return rawHref;
  }
}
