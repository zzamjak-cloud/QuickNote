// Notion HTML export 의 내부 페이지 href 를 스캔된 페이지 path 로 해석한다.

export type NotionPathNormalizer = {
  normalizePath: (value: string) => string;
  normalizeSegment: (value: string) => string;
  pathDirname: (path: string) => string;
  pathBasename: (path: string) => string;
};

export function extractNotionHexId(value: string): string | null {
  const matches = value.match(/[0-9a-f]{32}/gi);
  if (!matches?.length) return null;
  // Notion export 파일명·href 는 페이지 id(hex32)를 끝에 둔다.
  return matches[matches.length - 1]!.toLowerCase();
}

function decodeHrefPath(rawHref: string): string {
  const hrefNoHash = rawHref.split("#")[0]?.split("?")[0] ?? rawHref;
  try {
    return decodeURIComponent(hrefNoHash).replace(/^\.\/+/, "");
  } catch {
    return hrefNoHash.replace(/^\.\/+/, "");
  }
}

function resolveRelativePath(sourcePath: string, hrefPath: string): string {
  const baseParts = sourcePath.split("/").slice(0, -1);
  for (const part of hrefPath.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") baseParts.pop();
    else baseParts.push(part);
  }
  return baseParts.join("/");
}

/** href 가 가리킬 수 있는 후보 path 목록(우선순위 순) */
export function buildNotionHrefPathCandidates(
  href: string,
  sourcePath: string,
  norm: NotionPathNormalizer,
): string[] {
  if (!href.trim() || /^https?:\/\//i.test(href)) return [];

  const decoded = decodeHrefPath(href);
  const candidates: string[] = [];
  const push = (path: string) => {
    const trimmed = path.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
    if (trimmed && !candidates.includes(trimmed)) candidates.push(trimmed);
  };

  const sourceDir = norm.pathDirname(sourcePath);
  const sourceFileBase = norm.pathBasename(sourcePath).replace(/\.html$/i, "");

  if (href.startsWith(".") || href.startsWith("/")) {
    push(resolveRelativePath(sourcePath, decoded));
  }

  push(decoded);
  if (sourceDir) push(`${sourceDir}/${decoded}`);

  // Notion: Parent.html 과 Parent/Child.html 이 형제·부모-자식 관계
  if (!decoded.includes("/")) {
    push(`${sourceFileBase}/${decoded}`);
    if (sourceDir) push(`${sourceDir}/${sourceFileBase}/${decoded}`);
  }

  return candidates;
}

export function resolveNotionPageHref(
  href: string,
  sourcePath: string,
  pages: ReadonlyArray<{ path: string; title: string }>,
  norm: NotionPathNormalizer,
): { path: string; title: string } | null {
  const candidates = buildNotionHrefPathCandidates(href, sourcePath, norm);
  const hrefHex = extractNotionHexId(href);

  for (const candidatePath of candidates) {
    const normalizedTarget = norm.normalizePath(candidatePath);
    const linked = pages.find((page) => {
      const normalizedPagePath = norm.normalizePath(page.path);
      if (normalizedPagePath === normalizedTarget) return true;
      if (normalizedPagePath.endsWith(`/${normalizedTarget}`)) return true;

      const pageBase = norm.normalizeSegment(norm.pathBasename(page.path));
      const targetBase = norm.normalizeSegment(norm.pathBasename(candidatePath));
      if (pageBase.length > 0 && pageBase === targetBase) return true;

      if (hrefHex && extractNotionHexId(page.path) === hrefHex) return true;
      return false;
    });
    if (linked) return linked;
  }

  if (hrefHex) {
    const byHex = pages.filter((page) => extractNotionHexId(page.path) === hrefHex);
    if (byHex.length === 1) return byHex[0] ?? null;
  }

  return null;
}
