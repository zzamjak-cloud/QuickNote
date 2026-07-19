import { sanitizeWebLinkHref } from "../safeUrl";

export type PublicViewerLinkAction =
  | { kind: "navigate"; pageId: string }
  | { kind: "navigatePublic"; href: string }
  | { kind: "open"; href: string };

type ResolveOptions = {
  currentOrigin?: string;
};

function normalizeOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

function looksLikeQuickNoteHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.includes("quick-note") ||
    host.includes("quicknote")
  );
}

function isLikelyQuickNoteUrl(raw: string, url: URL, currentOrigin: string | null): boolean {
  const trimmed = raw.trim();
  if (trimmed.startsWith("/") || trimmed.startsWith("?")) return true;
  if (currentOrigin && url.origin === currentOrigin) return true;
  if (url.protocol !== "http:" && url.protocol !== "https:") return true;
  return looksLikeQuickNoteHost(url.hostname);
}

function parseQuickNotePageHref(
  raw: string,
  opts: ResolveOptions = {},
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("quicknote://page/")) {
    try {
      const url = new URL(trimmed);
      const pageId = url.pathname.replace(/^\/+/, "");
      return pageId || null;
    } catch {
      return null;
    }
  }

  const currentOrigin = normalizeOrigin(opts.currentOrigin);
  try {
    const url = new URL(trimmed, currentOrigin ?? "https://quicknote.local");
    if (!isLikelyQuickNoteUrl(trimmed, url, currentOrigin)) return null;
    const pageId = url.searchParams.get("page");
    return pageId || null;
  } catch {
    return null;
  }
}

function parsePublicRootHref(
  raw: string,
  opts: ResolveOptions = {},
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const currentOrigin = normalizeOrigin(opts.currentOrigin);
  try {
    const url = new URL(trimmed, currentOrigin ?? "https://quicknote.local");
    const isRelative = trimmed.startsWith("/");
    if (!isRelative && (!currentOrigin || url.origin !== currentOrigin)) return null;
    if (currentOrigin && url.origin !== currentOrigin) return null;
    if (url.search || url.hash) return null;
    const match = /^\/p\/([A-Za-z0-9_-]{16,64})\/?$/.exec(url.pathname);
    return match ? `/p/${match[1]}` : null;
  } catch {
    return null;
  }
}

/**
 * 공개 뷰어의 링크 클릭 해석.
 * - 게시 트리 안 QuickNote 페이지 링크는 공개 뷰어 내부 이동으로 처리한다.
 * - 별도 토큰의 공개 루트 링크는 같은 탭 전체 이동으로 처리한다.
 * - 게시 트리 밖 QuickNote 링크는 ID 노출/무단 이동 방지를 위해 무시한다.
 * - 그 외 안전한 웹 링크는 새 탭 열기 대상으로 반환한다.
 */
export function resolvePublicViewerLinkAction(
  rawHref: string,
  publishedPageIds: ReadonlySet<string>,
  opts: ResolveOptions = {},
): PublicViewerLinkAction | null {
  const href = rawHref.trim();
  if (!href) return null;

  const pageId = parseQuickNotePageHref(href, opts);
  if (pageId) {
    return publishedPageIds.has(pageId) ? { kind: "navigate", pageId } : null;
  }

  const publicHref = parsePublicRootHref(href, opts);
  if (publicHref) return { kind: "navigatePublic", href: publicHref };

  const safeHref = sanitizeWebLinkHref(href);
  return safeHref ? { kind: "open", href: safeHref } : null;
}
