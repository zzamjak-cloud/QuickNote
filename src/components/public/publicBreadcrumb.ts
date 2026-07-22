import type { PublicPageMeta, PublicSite } from "../../lib/publicView/api";

// parentId 체인 상한 — 순환/비정상 데이터에서 무한 루프를 막는다.
const BREADCRUMB_MAX_DEPTH = 100;

/** 게시 루트 → 현재 페이지 경로. 트리 밖/순환이면 도달 가능한 구간까지만 반환한다. */
export function buildPublicBreadcrumb(
  site: PublicSite,
  pageId: string,
): PublicPageMeta[] {
  const byId = new Map(site.pages.map((page) => [page.id, page]));
  const path: PublicPageMeta[] = [];
  const visited = new Set<string>();
  let currentId: string | null = pageId;

  while (
    currentId &&
    !visited.has(currentId) &&
    path.length < BREADCRUMB_MAX_DEPTH
  ) {
    visited.add(currentId);
    const meta = byId.get(currentId);
    if (!meta) break;
    path.push(meta);
    if (currentId === site.rootId) break;
    currentId = meta.parentId;
  }

  return path.reverse();
}
